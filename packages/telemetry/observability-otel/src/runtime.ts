/** Standard OTel global ownership and privacy-limited operation recording. */
import { context, diag, metrics, trace, SpanKind, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, type SpanExporter } from '@opentelemetry/sdk-trace-base'
import { MeterProvider, PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import type { Operation, Outcome, ResolvedConfig, SafeAttributes } from './types.ts'

const ownerKey = Symbol.for('@deepseek-ai/dsh-observability-otel/owner')
const kinds = {
  internal: SpanKind.INTERNAL, client: SpanKind.CLIENT, server: SpanKind.SERVER,
  producer: SpanKind.PRODUCER, consumer: SpanKind.CONSUMER,
}

function diagnostic(message: string): void {
  try { diag.warn(message) } catch (error) {
    // A host diagnostic sink cannot change application behavior.
    void error
  }
}

/** In-memory exporter injection for tests; production uses OTLP HTTP/protobuf. */
export interface Exporters {
  traces?: SpanExporter
  metrics?: PushMetricExporter
}

/** Process-owned standard providers; callers must await shutdown before mounting a successor. */
export class ObservabilityRuntime {
  private traceProvider: BasicTracerProvider | undefined
  private meterProvider: MeterProvider | undefined
  private manager: AsyncLocalStorageContextManager | undefined
  private ownedTrace = false
  private ownedMetrics = false
  private ownedContext = false
  private closed = false
  private closing: Promise<void> | undefined
  private readonly active = new Set<Operation>()
  private readonly names = new Set<string>()

  private constructor(private readonly config: ResolvedConfig) {}

  /**
   * Acquire providers, awaiting complete rollback before rejecting failed activation.
   * @param config - Validated startup selection and limits.
   * @param exporters - Optional test-owned exporters.
   * @returns Ready process-owned runtime.
   */
  static async create(config: ResolvedConfig, exporters: Exporters = {}): Promise<ObservabilityRuntime> {
    const runtime = new ObservabilityRuntime(config)
    try {
      runtime.initialize(exporters)
      return runtime
    } catch (error) {
      await runtime.shutdown()
      throw error
    }
  }

  private initialize(exporters: Exporters): void {
    const config = this.config
    if (!config.enabled) return
    if (Reflect.get(globalThis, ownerKey)) throw new Error('observability: another runtime owns this process')
    Reflect.set(globalThis, ownerKey, this)
    this.manager = new AsyncLocalStorageContextManager()
    this.ownedContext = context.setGlobalContextManager(this.manager)
    if (!this.ownedContext) throw new Error('observability: global context manager already registered')
    this.manager.enable()
    const resource = resourceFromAttributes({ 'service.name': config.serviceName, ...(config.serviceVersion ? { 'service.version': config.serviceVersion } : {}) })
    if (config.traces) {
      this.traceProvider = new BasicTracerProvider({
        resource,
        sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
        spanProcessors: [new BatchSpanProcessor(exporters.traces ?? new OTLPTraceExporter({
          ...(config.traceEndpoint ? { url: config.traceEndpoint } : {}), timeoutMillis: config.exportTimeoutMillis,
        }), {
          maxQueueSize: config.maxQueueSize, maxExportBatchSize: config.maxExportBatchSize,
          scheduledDelayMillis: config.scheduledDelayMillis, exportTimeoutMillis: config.exportTimeoutMillis,
        })],
      })
      this.ownedTrace = trace.setGlobalTracerProvider(this.traceProvider)
      if (!this.ownedTrace) throw new Error('observability: global trace provider already registered')
    }
    if (config.metrics) {
      this.meterProvider = new MeterProvider({
        resource,
        views: [{ instrumentName: 'dsh.operation.*', aggregationCardinalityLimit: config.metricCardinalityLimit }],
        readers: [new PeriodicExportingMetricReader({
          exporter: exporters.metrics ?? new OTLPMetricExporter({
            ...(config.metricEndpoint ? { url: config.metricEndpoint } : {}), timeoutMillis: config.exportTimeoutMillis,
          }),
          exportIntervalMillis: config.metricIntervalMillis, exportTimeoutMillis: config.exportTimeoutMillis,
        })],
      })
      this.ownedMetrics = metrics.setGlobalMeterProvider(this.meterProvider)
      if (!this.ownedMetrics) throw new Error('observability: global meter provider already registered')
    }
  }

  /**
   * Begin an operation; unselected owners retain the nearest active parent.
   * @param owner - Exact stable plugin package name, never a scope or user identifier.
   * @param operation - Stable source-authored operation name, never interpolated input.
   * @param attributes - Allowlisted stable metadata only.
   * @returns An idempotent handle; overflow becomes a transparent no-op.
   */
  start(owner: string, operation: string, attributes?: SafeAttributes): Operation {
    if (this.closed || !this.config.enabled) return { spanContext: undefined, with: fn => fn(), end: () => {} }
    try {
      return this.startRecording(owner, operation, attributes)
    } catch (error) {
      // SDK failures must never prevent the application callback from running.
      void error
      diagnostic('observability: operation setup failed')
      return { spanContext: undefined, with: fn => fn(), end: () => {} }
    }
  }

  /**
   * Check exact owner selection without creating spans, metrics, or timers.
   * @param owner - Exact stable plugin package name.
   * @returns Whether the open runtime has at least one enabled selected signal for the owner.
   */
  selected(owner: string): boolean {
    if (this.closed || !this.config.enabled) return false
    const selection = (Object.hasOwn(this.config.collection.plugins, owner)
      ? this.config.collection.plugins[owner] : undefined) ?? this.config.collection.default
    return (this.config.traces && selection.traces) || (this.config.metrics && selection.metrics)
  }

  /**
   * Record a completed duration beneath the active parent with only stable operation metadata.
   * Invalid durations are silently skipped; span timestamps end now and start durationMs earlier.
   * @param owner - Exact stable plugin package name.
   * @param operation - Stable source-authored operation name.
   * @param durationMs - Finite duration from 0 through 300000 milliseconds, inclusive.
   * @param outcome - Stable terminal classification; defaults to success.
   * @returns Nothing; instrumentation failures do not escape.
   */
  recordDuration(owner: string, operation: string, durationMs: number, outcome?: Outcome): void {
    if (this.closed || !this.config.enabled || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 300000) return
    try {
      this.startRecording(owner, operation, undefined, durationMs).end(outcome)
    } catch (error) {
      // SDK failures cannot change application behavior.
      void error
      diagnostic('observability: operation setup failed')
    }
  }

  /**
   * Record trusted Host wall-clock endpoints beneath the active parent; invalid intervals are skipped.
   * @param owner - Exact source-authored owner.
   * @param operation - Fixed source-authored operation.
   * @param startTimeUnixMs - Nonnegative finite Unix milliseconds.
   * @param endTimeUnixMs - Finite endpoint, not earlier than start and at most 300000ms later.
   * @param outcome - Independent phase outcome; defaults to success.
   * @param children - Optional trusted nested interval recorder, never application work.
   */
  recordInterval(owner: string, operation: string, startTimeUnixMs: number, endTimeUnixMs: number,
    outcome?: Outcome, children?: () => void): void {
    if (this.closed || !this.config.enabled || !Number.isFinite(startTimeUnixMs) || !Number.isFinite(endTimeUnixMs)
      || startTimeUnixMs < 0 || endTimeUnixMs < startTimeUnixMs || endTimeUnixMs - startTimeUnixMs > 300000) return
    try {
      const interval = this.startRecording(owner, operation, undefined, endTimeUnixMs - startTimeUnixMs, endTimeUnixMs)
      try { interval.with(() => children?.()) } finally { interval.end(outcome) }
    } catch (error) {
      // Instrumentation cannot replace application results.
      void error
      diagnostic('observability: interval setup failed')
    }
  }

  private startRecording(
    owner: string, operation: string, attributes?: SafeAttributes, durationMs?: number, intervalEnd?: number,
  ): Operation {
    const parent = context.active()
    const noop: Operation = { spanContext: undefined, with: fn => context.with(parent, fn), end: () => {} }
    const selection = (Object.hasOwn(this.config.collection.plugins, owner)
      ? this.config.collection.plugins[owner] : undefined) ?? this.config.collection.default
    const collectTrace = this.config.traces && selection.traces
    const collectMetrics = this.config.metrics && selection.metrics
    if (!collectTrace && !collectMetrics) return noop
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(owner) || !/^[a-zA-Z][a-zA-Z0-9_ ./:-]{0,159}$/.test(operation)) {
      diagnostic('observability: invalid stable owner or operation name; collection skipped')
      return noop
    }
    const key = `${owner}:${operation}`
    if (this.active.size >= this.config.maxActiveOperations || (!this.names.has(key) && this.names.size >= this.config.maxOperationNames)) {
      diagnostic('observability: operation capacity reached; collection skipped')
      return noop
    }
    this.names.add(key)
    const metadata: Attributes = { 'dsh.owner': owner, 'dsh.operation': operation }
    if (attributes?.retry !== undefined) metadata['dsh.retry'] = attributes.retry
    const endTime = durationMs === undefined ? undefined : intervalEnd ?? Date.now()
    const startTime = endTime !== undefined && durationMs !== undefined ? endTime - durationMs : undefined
    const span = collectTrace ? this.traceProvider?.getTracer(owner).startSpan(operation, {
      attributes: metadata, kind: kinds[attributes?.kind ?? 'internal'],
      ...(startTime === undefined ? {} : { startTime }),
    }, parent) : undefined
    const current = span ? trace.setSpan(parent, span) : parent
    const started = performance.now()
    let ended = false
    const handle: Operation = {
      spanContext: span?.spanContext(),
      with: fn => context.with(ended || this.closed ? parent : current, fn),
      end: (outcome: Outcome = 'success') => {
        if (ended) return
        ended = true
        this.active.delete(handle)
        try {
          span?.setAttribute('dsh.outcome', outcome)
          span?.setStatus({ code: outcome === 'error' || outcome === 'timeout' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET })
          span?.end(endTime)
          if (collectMetrics) {
            const meter = this.meterProvider?.getMeter(owner)
            const labels = { ...metadata, 'dsh.outcome': outcome }
            meter?.createCounter('dsh.operation.count', { description: 'Settled operations', unit: '{operation}' }).add(1, labels)
            meter?.createHistogram('dsh.operation.duration', { description: 'Operation duration', unit: 's' }).record((durationMs ?? (performance.now() - started)) / 1000, labels)
          }
        } catch (error) {
          // Instrumentation failure must not replace an application result or exception.
          void error
          diagnostic('observability: operation settlement failed')
        }
      },
    }
    this.active.add(handle)
    return handle
  }

  /**
   * Observe synchronous or native Promise completion without replacing its value or rejection.
   * @param owner - Exact plugin owner.
   * @param operation - Stable source-authored name.
   * @param fn - Application callback; no arguments or results are recorded.
   * @param attributes - Allowlisted stable metadata.
   * @returns The original value, including original Promise identity; thenables need a manual handle.
   */
  run<T>(owner: string, operation: string, fn: () => T, attributes?: SafeAttributes): T {
    if (this.closed || !this.config.enabled) return fn()
    const handle = this.start(owner, operation, attributes)
    return handle.with(() => {
      try {
        const value = fn()
        if (value instanceof Promise) void value.then(() => { handle.end() }, () => { handle.end('error') })
        else handle.end()
        return value
      } catch (error) {
        handle.end('error')
        throw error
      }
    })
  }

  /** Flush bounded SDK queues; this does not stop collection. @returns Completion of both signal flushes. */
  async forceFlush(): Promise<void> {
    await Promise.all([this.traceProvider?.forceFlush(), this.meterProvider?.forceFlush()])
  }

  /** Stop collection and await SDK drain; request timeouts do not bound total drain time. @returns Idempotent shutdown completion. */
  shutdown(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    if (!this.config.enabled) {
      this.closing = Promise.resolve()
      return this.closing
    }
    for (const operation of this.active) operation.end('cancelled')
    if (this.ownedTrace) trace.disable()
    if (this.ownedMetrics) metrics.disable()
    if (this.ownedContext) context.disable()
    this.manager?.disable()
    this.closing = (async () => {
      try {
        await Promise.allSettled([this.traceProvider?.shutdown(), this.meterProvider?.shutdown()])
      } finally {
        if (Reflect.get(globalThis, ownerKey) === this) Reflect.deleteProperty(globalThis, ownerKey)
        this.names.clear()
      }
    })()
    return this.closing
  }
}
