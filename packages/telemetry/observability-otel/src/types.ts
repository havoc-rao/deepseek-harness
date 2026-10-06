/** Public performance instrumentation types; payloads and raw errors are intentionally absent. */
import type { SpanContext } from '@opentelemetry/api'

/** Signals collected for an exact plugin owner. */
export interface Signals {
  /** Collect traces for the selected plugin owner. */
  traces: boolean
  /** Collect operation count and duration independently of trace sampling. */
  metrics: boolean
}

/** Bounded stable metadata; never pass user input, paths, identifiers, or model content. */
export interface SafeAttributes {
  kind?: 'internal' | 'client' | 'server' | 'producer' | 'consumer'
  retry?: boolean
}

/** Terminal classification, without an exception message or stack. */
export type Outcome = 'success' | 'error' | 'cancelled' | 'timeout'

/** An explicitly ended operation for streaming and non-Promise lifetimes. */
export interface Operation {
  /** Standard trace identity, absent when tracing is disabled. */
  readonly spanContext: SpanContext | undefined
  /**
   * Run one callback under this operation's parent context, including async continuations.
   * @param fn - Application callback; values and exceptions pass through unchanged.
   * @returns The original callback value, including Promise identity.
   */
  with<T>(fn: () => T): T
  /**
   * Settle once; duplicate calls and calls after disposal do nothing.
   * @param outcome - Stable terminal classification; defaults to success.
   */
  end(outcome?: Outcome): void
}

/** User approval, collection selection, and bounded exporter configuration. */
export interface Config {
  /** Explicit operator approval; defaults to false. */
  enabled?: boolean
  /** Base collector URL; each signal appends its standard OTLP path. */
  endpoint?: string
  /** Stable resource service name; defaults to OTEL_SERVICE_NAME or dsh. */
  serviceName?: string
  /** Optional stable application release version. */
  serviceVersion?: string
  /** Trace provider selection, endpoint, and root sampling. */
  traces?: {
    /** Enable traces after approval; defaults to true. */
    enabled?: boolean
    /** Complete trace collector URL, overriding the base endpoint. */
    endpoint?: string
    /** Root trace sampling ratio between zero and one; defaults to one. */
    sampleRatio?: number
  }
  /** Metric provider selection and endpoint. */
  metrics?: {
    /** Enable metrics after approval; defaults to true. */
    enabled?: boolean
    /** Complete metric collector URL, overriding the base endpoint. */
    endpoint?: string
  }
  /** Exact plugin-owner collection policy. */
  collection?: {
    /** Policy for owners without an exact rule; both signals default off. */
    default?: Signals
    /** Complete per-owner policies; no prefix or wildcard matching. */
    plugins?: Record<string, Signals>
  }
  /** Maximum queued spans; defaults to 2048. */
  maxQueueSize?: number
  /** Maximum spans per export batch; defaults to 512. */
  maxExportBatchSize?: number
  /** Span batch delay in milliseconds; defaults to 5000. */
  scheduledDelayMillis?: number
  /** Per-export timeout in milliseconds; defaults to 5000. */
  exportTimeoutMillis?: number
  /** Metric export interval in milliseconds; defaults to 30000. */
  metricIntervalMillis?: number
  /** Maximum simultaneously active helper operations; defaults to 4096. */
  maxActiveOperations?: number
  /** Maximum distinct owner/operation pairs; defaults to 256. */
  maxOperationNames?: number
  /** SDK metric aggregation cardinality limit; defaults to 2048. */
  metricCardinalityLimit?: number
}

/** Fully resolved configuration; runtime methods never consult environment variables. */
export interface ResolvedConfig {
  enabled: boolean
  traces: boolean
  metrics: boolean
  traceEndpoint: string | undefined
  metricEndpoint: string | undefined
  serviceName: string
  serviceVersion: string | undefined
  sampleRatio: number
  collection: { default: Signals; plugins: Readonly<Record<string, Signals>> }
  maxQueueSize: number
  maxExportBatchSize: number
  scheduledDelayMillis: number
  exportTimeoutMillis: number
  metricIntervalMillis: number
  maxActiveOperations: number
  maxOperationNames: number
  metricCardinalityLimit: number
}
