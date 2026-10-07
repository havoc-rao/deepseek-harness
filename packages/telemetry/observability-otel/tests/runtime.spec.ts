/** In-memory exporters keep global ownership and async context tests network-free. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { context, metrics, trace, ROOT_CONTEXT } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { AggregationTemporality, DataPointType, InMemoryMetricExporter, MeterProvider } from '@opentelemetry/sdk-metrics'
import { Context } from '@deepseek-ai/cordis'
import Observability from '../src/index.ts'
import { ObservabilityRuntime } from '../src/runtime.ts'
import { resolveConfig } from '../src/index.ts'
import type { Config } from '../src/types.ts'

const owner = '@deepseek-ai/dsh-test'
const runtimes: ObservabilityRuntime[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const runtime of runtimes.splice(0)) await runtime.shutdown()
})
async function fixture(overrides: Config = {}) {
  const spans = new InMemorySpanExporter()
  const measurements = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const runtime = await ObservabilityRuntime.create(resolveConfig({ enabled: true, endpoint: 'http://127.0.0.1:4318', collection: { default: { traces: true, metrics: true } }, ...overrides }, {}), { traces: spans, metrics: measurements })
  runtimes.push(runtime)
  return { runtime, spans, measurements }
}

describe('observability runtime', () => {
  it('leaves values exceptions and promise identity untouched while off', async () => {
    const { runtime, spans } = await fixture({ enabled: false })
    const value = { secret: 'payload' }
    expect(runtime.run(owner, 'sync', () => value)).toBe(value)
    const promise = Promise.resolve(value)
    expect(runtime.run(owner, 'async', () => promise)).toBe(promise)
    expect(() => runtime.run(owner, 'fail', () => { throw value })).toThrow()
    await runtime.forceFlush()
    expect(spans.getFinishedSpans()).toHaveLength(0)
  })

  it('records counts with unsampled traces and preserves rejected objects', async () => {
    const { runtime, spans, measurements } = await fixture({ traces: { sampleRatio: 0 } })
    const error = new Error('private error contents')
    const promise = runtime.run(owner, 'failure', () => Promise.reject(error))
    await expect(promise).rejects.toBe(error)
    await runtime.forceFlush()
    expect(spans.getFinishedSpans()).toHaveLength(0)
    const output = JSON.stringify(measurements.getMetrics())
    expect(output).toContain('dsh.operation.count')
    expect(output).toContain('dsh.operation.duration')
    expect(output).toContain('error')
    expect(output).not.toContain(error.message)
  })

  it('keeps nearest active parent across disabled owners and async continuations', async () => {
    const { runtime, spans } = await fixture({ collection: { default: { traces: true, metrics: true }, plugins: { '@deepseek-ai/dsh-disabled': { traces: false, metrics: false } } } })
    await runtime.run(owner, 'parent', () => runtime.run('@deepseek-ai/dsh-disabled', 'hidden', async () => {
      await Promise.resolve()
      runtime.run(owner, 'child', () => 7)
      trace.getTracer('external').startSpan('standard-api-child').end()
    }))
    await runtime.forceFlush()
    const finished = spans.getFinishedSpans()
    const parent = finished.find(span => span.name === 'parent')!
    expect(finished.map(span => span.name).sort()).toEqual(['child', 'parent', 'standard-api-child'])
    expect(finished.find(span => span.name === 'child')!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
    expect(finished.find(span => span.name === 'standard-api-child')!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
  })

  it('records reported durations and counts with explicit timestamps and bounded metadata', async () => {
    const { runtime, spans, measurements } = await fixture()
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      runtime.recordDuration(owner, 'phase.zero', 0)
      runtime.recordDuration(owner, 'phase.fractional', 125.5, 'error')
      runtime.recordDuration(owner, 'phase.maximum', 300000, 'timeout')
      runtime.recordDuration(owner, 'phase.cancelled', 25, 'cancelled')
    } finally {
      clock.mockRestore()
    }
    await runtime.forceFlush()
    const finished = spans.getFinishedSpans()
    expect(finished).toHaveLength(4)
    for (const [index, duration] of [0, 125.5, 300000, 25].entries()) {
      const span = finished[index]!
      expect(span.endTime[0] * 1000 + span.endTime[1] / 1e6).toBe(now)
      expect(span.duration[0] * 1000 + span.duration[1] / 1e6).toBeCloseTo(duration, 3)
      expect(span.attributes).toEqual({
        'dsh.owner': owner, 'dsh.operation': span.name,
        'dsh.outcome': ['success', 'error', 'timeout', 'cancelled'][index],
      })
      expect(span.events).toEqual([])
      expect(span.status.message).toBeUndefined()
    }
    const exported = measurements.getMetrics().flatMap(batch => batch.scopeMetrics.flatMap(scope => scope.metrics))
    const count = exported.find(metric => metric.descriptor.name === 'dsh.operation.count')!
    expect(count.dataPoints.map(point => point.value)).toEqual([1, 1, 1, 1])
    const duration = exported.find(metric => metric.descriptor.name === 'dsh.operation.duration')!
    expect(duration.descriptor.unit).toBe('s')
    expect(duration.dataPointType).toBe(DataPointType.HISTOGRAM)
    if (duration.dataPointType === DataPointType.HISTOGRAM) {
      expect(duration.dataPoints.map(point => point.value.count)).toEqual([1, 1, 1, 1])
      expect(duration.dataPoints.map(point => point.value.sum)).toEqual([0, 0.1255, 300, 0.025])
      expect(duration.dataPoints.map(point => point.attributes)).toEqual(finished.map(span => span.attributes))
    }
  })

  it('records trusted interval endpoints independently of report receipt and phase outcome', async () => {
    const { runtime, spans, measurements } = await fixture()
    const started = 1700000000010
    runtime.run(owner, 'root', () => {
      runtime.recordInterval(owner, 'phase.success', started, started + 20, 'success')
      runtime.recordInterval(owner, 'phase.error', started + 25, started + 45, 'error')
      for (const [start, end] of [[-1, 0], [10, 9], [0, 300001], [NaN, 1], [0, Infinity]]) {
        runtime.recordInterval(owner, 'invalid', start!, end!)
      }
    })
    await runtime.forceFlush()
    const finished = spans.getFinishedSpans()
    const root = finished.find(span => span.name === 'root')!
    const good = finished.find(span => span.name === 'phase.success')!
    const bad = finished.find(span => span.name === 'phase.error')!
    const millis = (value: [number, number]) => value[0] * 1000 + value[1] / 1e6
    expect(millis(good.startTime)).toBe(started)
    expect(millis(good.endTime)).toBe(started + 20)
    expect(millis(bad.startTime)).toBe(started + 25)
    expect(millis(bad.endTime)).toBe(started + 45)
    expect(good.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    expect(good.attributes['dsh.outcome']).toBe('success')
    expect(bad.attributes['dsh.outcome']).toBe('error')
    expect(finished.some(span => span.name === 'invalid')).toBe(false)
    const output = JSON.stringify(measurements.getMetrics())
    expect(output).toContain('phase.success')
    expect(output).toContain('phase.error')
    expect(output).not.toContain('invalid')
  })

  it('silently skips invalid durations and names without consuming bounded operation names', async () => {
    const { runtime, spans, measurements } = await fixture({ maxOperationNames: 1 })
    for (const duration of [NaN, Infinity, -Infinity, -1, 300000.001]) {
      runtime.recordDuration(owner, 'invalid.duration', duration)
    }
    runtime.recordDuration('private owner payload', 'phase', 10)
    runtime.recordDuration(owner, 'private\noperation', 10)
    runtime.recordDuration(owner, 'phase', 10)
    await runtime.forceFlush()
    expect(spans.getFinishedSpans().map(span => span.name)).toEqual(['phase'])
    const output = JSON.stringify(measurements.getMetrics())
    expect(output).toContain('phase')
    expect(output).not.toContain('invalid.duration')
    expect(output).not.toContain('private')
  })

  it('nests reported phases beneath the active host parent without changing its context', async () => {
    const { runtime, spans } = await fixture()
    await runtime.run(owner, 'host', async () => {
      await Promise.resolve()
      const parent = trace.getSpan(context.active())!.spanContext().spanId
      runtime.recordDuration(owner, 'browser.phase', 120)
      expect(trace.getSpan(context.active())!.spanContext().spanId).toBe(parent)
      runtime.run(owner, 'host.continuation', () => 1)
    })
    await runtime.forceFlush()
    const finished = spans.getFinishedSpans()
    const parent = finished.find(span => span.name === 'host')!
    for (const name of ['browser.phase', 'host.continuation']) {
      expect(finished.find(span => span.name === name)!.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
    }
  })

  it('selects exact owners and records metrics-only durations independently of trace sampling', async () => {
    const { runtime, spans, measurements } = await fixture({
      traces: { sampleRatio: 0 },
      collection: { default: { traces: false, metrics: false }, plugins: {
        [owner]: { traces: false, metrics: true },
        '@example/traced': { traces: true, metrics: true },
      } },
    })
    expect(runtime.selected(owner)).toBe(true)
    expect(runtime.selected('@example/traced')).toBe(true)
    expect(runtime.selected(`${owner}-child`)).toBe(false)
    runtime.recordDuration(owner, 'metrics.phase', 250)
    runtime.recordDuration('@example/traced', 'unsampled.phase', 500)
    runtime.recordDuration(`${owner}-child`, 'excluded', 1000)
    await runtime.forceFlush()
    expect(spans.getFinishedSpans()).toEqual([])
    const exported = measurements.getMetrics().flatMap(batch => batch.scopeMetrics.flatMap(scope => scope.metrics))
    const durations = exported.filter(metric => metric.descriptor.name === 'dsh.operation.duration')
    expect(durations).toHaveLength(2)
    for (const metric of durations) {
      expect(metric.dataPointType).toBe(DataPointType.HISTOGRAM)
      if (metric.dataPointType === DataPointType.HISTOGRAM) {
        expect(metric.dataPoints[0]!.value.count).toBe(1)
        expect(metric.dataPoints[0]!.value.sum).toBe(metric.dataPoints[0]!.attributes['dsh.owner'] === owner ? 0.25 : 0.5)
      }
    }
    expect(JSON.stringify(measurements.getMetrics())).not.toContain('excluded')
    await runtime.shutdown()
    expect(runtime.selected(owner)).toBe(false)
    runtime.recordDuration(owner, 'late', 1)
  })

  it('reports no selection when the selected signal is disabled', async () => {
    const { runtime } = await fixture({
      traces: { enabled: false },
      collection: { default: { traces: true, metrics: false } },
    })
    expect(runtime.selected(owner)).toBe(false)
    await runtime.shutdown()
    const disabled = await fixture({ enabled: false })
    expect(disabled.runtime.selected(owner)).toBe(false)
    disabled.runtime.recordDuration(owner, 'disabled', 10)
    await disabled.runtime.forceFlush()
    expect(disabled.spans.getFinishedSpans()).toEqual([])
    expect(disabled.measurements.getMetrics()).toEqual([])
  })

  it('isolates overlapping async roots with an explicit barrier', async () => {
    const { runtime, spans } = await fixture()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = runtime.run(owner, 'first', async () => { await gate; runtime.run(owner, 'first.child', () => 1) })
    const second = runtime.run(owner, 'second', async () => { release(); await gate; runtime.run(owner, 'second.child', () => 2) })
    await Promise.all([first, second])
    await runtime.forceFlush()
    for (const name of ['first', 'second']) {
      const parent = spans.getFinishedSpans().find(span => span.name === name)!
      const child = spans.getFinishedSpans().find(span => span.name === `${name}.child`)!
      expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
      expect(parent.parentSpanContext).toBeUndefined()
    }
  })

  it('settles cancelled handles once and bounds active/name retention', async () => {
    const { runtime, spans } = await fixture({ maxActiveOperations: 1, maxOperationNames: 1 })
    const operation = runtime.start(owner, 'stream')
    runtime.run(owner, 'overflow', () => 3)
    operation.end('cancelled')
    operation.end('error')
    runtime.run(owner, 'new-name', () => 4)
    await runtime.forceFlush()
    expect(spans.getFinishedSpans()).toHaveLength(1)
    expect(spans.getFinishedSpans()[0]!.attributes['dsh.outcome']).toBe('cancelled')
  })

  it('rejects concurrent owners and allows a successor after idempotent shutdown', async () => {
    const { runtime } = await fixture()
    await expect(fixture()).rejects.toThrow('another runtime')
    const ending = runtime.shutdown()
    expect(runtime.shutdown()).toBe(ending)
    await ending
    const successor = await fixture()
    successor.runtime.run(owner, 'successor', () => 1)
    await successor.runtime.forceFlush()
    expect(successor.spans.getFinishedSpans()).toHaveLength(1)
    expect(context.active()).toBe(ROOT_CONTEXT)
  })

  it('supports exact metrics-only external owners and rejects scope-like prefix matching', async () => {
    const { runtime, spans, measurements } = await fixture({ collection: { default: { traces: false, metrics: false }, plugins: { '@example/plugin': { traces: false, metrics: true } } } })
    runtime.run('@example/plugin', 'gateway.invoke session/list', () => 1)
    runtime.run('@example/plugin-child', 'excluded', () => 2)
    await runtime.forceFlush()
    expect(spans.getFinishedSpans()).toHaveLength(0)
    const output = JSON.stringify(measurements.getMetrics())
    expect(output).toContain('gateway.invoke session/list')
    expect(output).not.toContain('excluded')
  })

  it('allocates no interval or timeout while disabled including disposal', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const interval = vi.spyOn(globalThis, 'setInterval')
    try {
      const { runtime } = await fixture({ enabled: false })
      await runtime.run(owner, 'off', () => Promise.resolve(1))
      expect(runtime.selected(owner)).toBe(false)
      runtime.recordDuration(owner, 'off.duration', 100)
      await runtime.shutdown()
      expect(timeout).not.toHaveBeenCalled()
      expect(interval).not.toHaveBeenCalled()
    } finally {
      timeout.mockRestore()
      interval.mockRestore()
    }
  })

  it('exports only allowlisted metadata and never raw results or exception details', async () => {
    const { runtime, spans } = await fixture()
    const attributes = { retry: true, payload: 'secret-argument' }
    const error = new Error('secret-exception')
    expect(() => runtime.run(owner, 'private', () => { throw error }, attributes)).toThrow(error)
    runtime.run(owner, 'value', () => ({ text: 'secret-result' }))
    await runtime.forceFlush()
    const finished = spans.getFinishedSpans()
    expect(finished[0]!.attributes).toEqual({ 'dsh.owner': owner, 'dsh.operation': 'private', 'dsh.retry': true, 'dsh.outcome': 'error' })
    expect(finished[0]!.events).toEqual([])
    const output = JSON.stringify(finished.map(span => ({ attributes: span.attributes, status: span.status, events: span.events })))
    expect(output).not.toContain('secret-')
  })

  it('rejects an existing global provider without replacing it', async () => {
    const provider = new BasicTracerProvider()
    expect(trace.setGlobalTracerProvider(provider)).toBe(true)
    try {
      await expect(fixture({ metrics: { enabled: false } })).rejects.toThrow('global trace provider')
      const span = trace.getTracer('existing').startSpan('existing')
      expect(span.isRecording()).toBe(true)
      span.end()
      await Promise.resolve()
    } finally {
      trace.disable()
      await provider.shutdown()
    }
  })

  it('awaits partial initialization rollback before rejecting and retains process ownership during drain', async () => {
    const foreign = new MeterProvider()
    expect(metrics.setGlobalMeterProvider(foreign)).toBe(true)
    const spans = new InMemorySpanExporter()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    vi.spyOn(spans, 'shutdown').mockImplementation(async () => { entered(); await gate })
    const pending = ObservabilityRuntime.create(resolveConfig({ enabled: true, endpoint: 'http://127.0.0.1:4318' }, {}), {
      traces: spans, metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    })
    let rejected = false
    const checked = expect(pending).rejects.toThrow('global meter provider').then(() => { rejected = true })
    try {
      await started
      expect(rejected).toBe(false)
      expect(metrics.getMeterProvider()).toBe(foreign)
      await expect(fixture()).rejects.toThrow('another runtime')
    } finally {
      release()
      await checked
      metrics.disable()
      await foreign.shutdown()
    }
    const successor = await fixture()
    await successor.runtime.shutdown()
  })

  it('disposal cancels open handles and late callback completion cannot restart collection', async () => {
    const { runtime, spans } = await fixture()
    const exported: string[] = []
    const originalExport = spans.export.bind(spans)
    vi.spyOn(spans, 'export').mockImplementation((batch, callback) => {
      exported.push(...batch.map(span => String(span.attributes['dsh.outcome'])))
      originalExport(batch, callback)
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const result = runtime.run(owner, 'pending', async () => { await gate; return 42 })
    await runtime.shutdown()
    release()
    await expect(result).resolves.toBe(42)
    expect(exported).toEqual(['cancelled'])
    expect(runtime.start(owner, 'late').spanContext).toBeUndefined()
  })

  it('disposes a Cordis service and removes its registration', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const fiber = ctx.plugin(Observability, { enabled: false })
    await fiber
    expect(ctx.get('observability')?.run(owner, 'off', () => 42)).toBe(42)
    expect(ctx.get('observability')?.selected(owner)).toBe(false)
    expect(ctx.get('observability')?.recordDuration(owner, 'off.duration', 100)).toBeUndefined()
    await fiber.dispose()
    expect(ctx.get('observability')).toBeUndefined()
  })
})
