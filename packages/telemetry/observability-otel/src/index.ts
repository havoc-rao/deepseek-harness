/** Opt-in Cordis performance collection with standard OTel traces and metrics. */
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { ObservabilityRuntime } from './runtime.ts'
import type { Config, Operation, SafeAttributes, ResolvedConfig, Signals } from './types.ts'

const signal = Schema.object({ traces: Schema.boolean().default(false), metrics: Schema.boolean().default(false) })
const fields = Schema.object({
  enabled: Schema.boolean(), endpoint: Schema.string(), serviceName: Schema.string(), serviceVersion: Schema.string(),
  traces: Schema.object({ enabled: Schema.boolean(), endpoint: Schema.string(), sampleRatio: Schema.number() }),
  metrics: Schema.object({ enabled: Schema.boolean(), endpoint: Schema.string() }),
  collection: Schema.object({ default: signal, plugins: Schema.dict(signal) }),
  maxQueueSize: Schema.number(), maxExportBatchSize: Schema.number(), scheduledDelayMillis: Schema.number(),
  exportTimeoutMillis: Schema.number(), metricIntervalMillis: Schema.number(), maxActiveOperations: Schema.number(),
  maxOperationNames: Schema.number(), metricCardinalityLimit: Schema.number(),
})

function validateKeys(value: unknown, schema: Schema, path: string): void {
  if (value === null) throw new Error(`observability: ${path} cannot be null`)
  if (schema.type !== 'object' && schema.type !== 'dict') return
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`observability: ${path} must be an object`)
  if (schema === signal && (!Object.hasOwn(value, 'traces') || !Object.hasOwn(value, 'metrics'))) {
    throw new Error(`observability: ${path} requires both traces and metrics`)
  }
  for (const [key, entry] of Object.entries(value)) {
    const child = schema.type === 'dict' ? schema.inner : schema.dict?.[key]
    if (!child || (schema.type === 'object' && !Object.hasOwn(schema.dict ?? {}, key))) {
      throw new Error(`observability: unknown configuration field ${path}.${key}`)
    }
    validateKeys(entry, child, `${path}.${key}`)
  }
}

/** Strict Loader schema with complete nested validation before default normalization. */
export const ConfigSchema = Schema.intersect([
  Schema.transform(Schema.any(), (value: unknown) => {
    try { validateKeys(value, fields, 'config') } catch (error) {
      throw new Schema.ValidationError(error instanceof Error ? error.message : 'invalid observability configuration', {})
    }
    return value
  }),
  fields,
])

/**
 * Parse startup configuration without coercing booleans or accepting unknown fields.
 * @param value - Untrusted Loader configuration.
 * @returns Validated optional configuration fields, before default resolution.
 */
export function parseConfig(value: unknown): Config {
  validateKeys(value, fields, 'config')
  return Schema.resolve(value, fields, {})[0] as Config
}

function positive(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`observability: ${name} must be a positive integer`)
  return result
}

function endpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('observability: endpoint must be HTTP(S) without credentials, query, or fragment')
  }
  return url.href
}

function signals(value: Signals | undefined): Signals {
  if (value !== undefined && (typeof value.traces !== 'boolean' || typeof value.metrics !== 'boolean')) {
    throw new Error('observability: collection rules require traces and metrics booleans')
  }
  return Object.freeze({ traces: value?.traces === true, metrics: value?.metrics === true })
}

/**
 * Resolve explicit opt-in, signal-specific strong-off environment values, and endpoint precedence.
 * @param input - Untrusted user-approved startup configuration.
 * @param env - Environment snapshot; injectable for isolated tests.
 * @returns Validated immutable selection and numeric resource bounds.
 */
export function resolveConfig(input: unknown = {}, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const config = parseConfig(input)
  const approved = config.enabled === true && env.OTEL_SDK_DISABLED?.toLowerCase() !== 'true'
  const traceMode = env.OTEL_TRACES_EXPORTER
  const metricMode = env.OTEL_METRICS_EXPORTER
  const traces = approved && config.traces?.enabled !== false && traceMode !== 'none'
  const metrics = approved && config.metrics?.enabled !== false && metricMode !== 'none'
  for (const [active, mode, protocol] of [
    [traces, traceMode, env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL],
    [metrics, metricMode, env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL],
  ] as const) {
    if (active && mode && mode !== 'otlp') throw new Error('observability: only otlp or none exporters are supported')
    if (active && protocol && protocol !== 'http/protobuf') throw new Error('observability: only http/protobuf is supported')
  }
  const base = config.endpoint ?? env.OTEL_EXPORTER_OTLP_ENDPOINT
  const traceEndpoint = traces ? endpoint(config.traces?.endpoint ?? env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? (base ? `${base.replace(/\/$/, '')}/v1/traces` : undefined)) : undefined
  const metricEndpoint = metrics ? endpoint(config.metrics?.endpoint ?? env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? (base ? `${base.replace(/\/$/, '')}/v1/metrics` : undefined)) : undefined
  if ((traces && !traceEndpoint) || (metrics && !metricEndpoint)) throw new Error('observability: each enabled signal requires an explicit endpoint')
  const sampleRatio = config.traces?.sampleRatio ?? 1
  if (!Number.isFinite(sampleRatio) || sampleRatio < 0 || sampleRatio > 1) throw new Error('observability: sampleRatio must be between zero and one')
  const maxQueueSize = positive(config.maxQueueSize, 2048, 'maxQueueSize')
  const maxExportBatchSize = positive(config.maxExportBatchSize, 512, 'maxExportBatchSize')
  if (maxExportBatchSize > maxQueueSize) throw new Error('observability: batch must not exceed queue')
  const exportTimeoutMillis = positive(config.exportTimeoutMillis, 5000, 'exportTimeoutMillis')
  const metricIntervalMillis = positive(config.metricIntervalMillis, 30000, 'metricIntervalMillis')
  if (metricIntervalMillis < exportTimeoutMillis) throw new Error('observability: metric interval must cover export timeout')
  const plugins = Object.fromEntries(Object.entries(config.collection?.plugins ?? {}).map(([owner, value]) => {
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(owner)) throw new Error('observability: collection plugin keys must be exact package names')
    return [owner, signals(value)]
  }))
  return {
    enabled: traces || metrics, traces, metrics, traceEndpoint, metricEndpoint,
    serviceName: config.serviceName ?? env.OTEL_SERVICE_NAME ?? 'dsh', serviceVersion: config.serviceVersion, sampleRatio,
    collection: { default: signals(config.collection?.default), plugins: Object.freeze(plugins) },
    maxQueueSize, maxExportBatchSize, exportTimeoutMillis, metricIntervalMillis,
    scheduledDelayMillis: positive(config.scheduledDelayMillis, 5000, 'scheduledDelayMillis'),
    maxActiveOperations: positive(config.maxActiveOperations, 4096, 'maxActiveOperations'),
    maxOperationNames: positive(config.maxOperationNames, 256, 'maxOperationNames'),
    metricCardinalityLimit: positive(config.metricCardinalityLimit, 2048, 'metricCardinalityLimit'),
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    observability: Observability
  }
}

/** Startup-only global runtime; disposal drains and unregisters only providers it owns. */
export default class Observability extends Service<Config> {
  static Config = ConfigSchema
  private runtime!: ObservabilityRuntime

  constructor(ctx: Context, private readonly options: Config = {}) {
    super(ctx, 'observability')
  }

  protected async [Service.init](): Promise<void> {
    const config = resolveConfig(this.options)
    const ready = Promise.resolve().then(() => ObservabilityRuntime.create(config))
    this.ctx.effect(() => async () => {
      const settled = await Promise.allSettled([ready])
      const result = settled[0]
      if (result.status === 'fulfilled') await result.value.shutdown()
    }, 'observability providers')
    this.runtime = await ready
  }

  /**
   * Observe callback completion without recording arguments, results, or errors.
   * @param owner - Exact plugin package name, not scope.
   * @param operation - Stable source-authored operation name.
   * @param fn - Callback whose value and exception are preserved.
   * @param attributes - Allowlisted stable metadata only.
   * @returns Original callback value, including native Promise identity.
   */
  run<T>(owner: string, operation: string, fn: () => T, attributes?: SafeAttributes): T {
    return this.runtime.run(owner, operation, fn, attributes)
  }

  /**
   * Begin a manual lifetime; activate each stream iterator call with handle.with().
   * @param owner - Exact plugin package name.
   * @param operation - Stable source-authored operation name.
   * @param attributes - Allowlisted stable metadata only.
   * @returns Handle to end on success, error, cancellation, or timeout.
   */
  start(owner: string, operation: string, attributes?: SafeAttributes): Operation {
    return this.runtime.start(owner, operation, attributes)
  }
}

export type { Config, Operation, Outcome, SafeAttributes, Signals } from './types.ts'
