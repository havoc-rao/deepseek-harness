/** Configuration tests use explicit environment snapshots without process mutation. */
import { describe, expect, it } from 'vitest'
import { resolveConfig, ConfigSchema } from '../src/index.ts'

const endpoint = 'http://127.0.0.1:4318'

describe('observability configuration', () => {
  it.each([
    { enabled: 'true' }, { enabled: true, endpoint, traces: { enabled: 'false' }, metrics: { enabled: false } },
    { metrics: { enabled: 0 } }, { collection: { default: { traces: false, metrics: 'false' } } },
    { collection: { plugins: { '@example/plugin': { traces: false, metrics: null } } } },
    { traces: false }, { metrics: [] }, { collection: null }, { serviceName: 42 }, { endpoint: 1 },
    { maxQueueSize: '100' }, { enabled: false, typo: true }, { traces: { enabeld: false } },
    { collection: { plugins: { owner: { traces: true, metrics: false, typo: true } } } },
  ])('rejects malformed Loader values before runtime acquisition: %j', async (value) => {
    expect(() => resolveConfig(value, {})).toThrow()
    expect((await ConfigSchema['~standard'].validate(value)).issues).toBeDefined()
  })

  it('requires explicit approval and treats SDK disable as strong off', () => {
    expect(resolveConfig({}, { OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }).enabled).toBe(false)
    expect(resolveConfig({ enabled: true }, { OTEL_SDK_DISABLED: 'true' }).enabled).toBe(false)
    expect(resolveConfig({ enabled: false }, { OTEL_SDK_DISABLED: 'false' }).enabled).toBe(false)
  })

  it('selects independent signals and exact plugin rules', () => {
    const value = resolveConfig({ enabled: true, endpoint, collection: { default: { traces: true, metrics: false }, plugins: { '@deepseek-ai/dsh-llm': { traces: false, metrics: true } } } }, { OTEL_TRACES_EXPORTER: 'none' })
    expect(value.traces).toBe(false)
    expect(value.metrics).toBe(true)
    expect(value.collection.plugins['@deepseek-ai/dsh-llm']).toEqual({ traces: false, metrics: true })
    expect(value.metricEndpoint).toBe(`${endpoint}/v1/metrics`)
  })

  it('requires endpoints and supports per-signal environment precedence', () => {
    expect(() => resolveConfig({ enabled: true }, {})).toThrow('explicit endpoint')
    const value = resolveConfig({ enabled: true, endpoint, traces: { endpoint: `${endpoint}/custom` } }, { OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${endpoint}/other` })
    expect(value.traceEndpoint).toBe(`${endpoint}/custom`)
    expect(value.metricEndpoint).toBe(`${endpoint}/other`)
  })

  it('rejects invalid export protocols endpoints and bounds', () => {
    expect(() => resolveConfig({ enabled: true, endpoint }, { OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' })).toThrow('http/protobuf')
    expect(() => resolveConfig({ enabled: true, endpoint }, { OTEL_TRACES_EXPORTER: 'console' })).toThrow('exporters')
    expect(() => resolveConfig({ enabled: true, endpoint: 'https://user:secret@example.com' }, {})).toThrow('credentials')
    expect(() => resolveConfig({ maxQueueSize: 1 }, {})).toThrow('batch')
    expect(() => resolveConfig({ maxActiveOperations: 0 }, {})).toThrow('positive integer')
    expect(() => resolveConfig({ traces: { sampleRatio: 2 } }, {})).toThrow('sampleRatio')
    expect(() => resolveConfig({ metricIntervalMillis: 1 }, {})).toThrow('interval')
  })
})
