/** In-memory or loopback OTLP runtime fixture for Session creation integration. */
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { AggregationTemporality, InMemoryMetricExporter } from '@opentelemetry/sdk-metrics'
import { resolveConfig } from '../src/index.ts'
import { ObservabilityRuntime } from '../src/runtime.ts'

/**
 * Create standard OTel providers with exact owner selection.
 * @param owners - Plugin owners whose traces and metrics are selected.
 * @param endpoint - Optional loopback endpoint using real HTTP/protobuf exporters.
 * @returns Runtime, optional in-memory observations, and standard OTel context/status observations.
 */
export async function creationTraceFixture(owners: readonly string[], endpoint?: string) {
  const spans = new InMemorySpanExporter()
  const measurements = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const config = resolveConfig({
    enabled: true, endpoint: endpoint ?? 'http://127.0.0.1:4318', serviceName: 'DSH',
    collection: { default: { traces: false, metrics: false }, plugins: Object.fromEntries(
      owners.map(owner => [owner, { traces: true, metrics: true }]),
    ) },
  }, {})
  const runtime = await ObservabilityRuntime.create(config, endpoint ? {} : { traces: spans, metrics: measurements })
  return {
    runtime, spans, measurements, isRootContext: () => context.active() === ROOT_CONTEXT,
    clientKind: SpanKind.CLIENT, errorStatus: SpanStatusCode.ERROR, unsetStatus: SpanStatusCode.UNSET,
  }
}
