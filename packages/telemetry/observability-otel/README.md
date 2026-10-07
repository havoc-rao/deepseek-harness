---
description: "Collect optional plugin performance traces and metrics through standard OpenTelemetry OTLP HTTP/protobuf."
kind: "package-reference"
---

# @deepseek-ai/dsh-observability-otel

English | [中文](README.zh.md)

## Summary

Collect operation durations and counts alongside nested traces after explicit user approval. Select traces and metrics independently for exact plugin owners, including metrics-only collection. Disabled collection creates no provider, exporter, interval, or timeout. Exported operation metadata excludes arguments, results, exception messages, and stacks.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

This optional Cordis service provides `ctx.observability`; consumers without a required injection read `ctx.get('observability')`. It does not replace the separate [OTel log transport](../otel/README.md), activate itself in shipped profiles, or obtain consent through a prompt. The operator must approve the endpoint and collection policy before enabling it.

### Configuration

The default is `enabled: false`. Enabling requires an explicit endpoint and a collection rule. The base endpoint appends `/v1/traces` and `/v1/metrics`; signal-specific endpoints are complete URLs. No implicit localhost collector is selected. Startup parsing rejects wrong field types, null values, and unknown fields; the string `"false"` cannot replace boolean `false`.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Explicit operator approval. |
| `endpoint` | unset | Base HTTP(S) collector URL; environment fallback is `OTEL_EXPORTER_OTLP_ENDPOINT`. |
| `traces.enabled`, `metrics.enabled` | `true` after approval | Independent provider switches. |
| `traces.endpoint`, `metrics.endpoint` | unset | Complete signal URLs, before signal-specific environment values and base endpoint. |
| `collection.default` | `{ traces: false, metrics: false }` | Selection for owners without an exact rule. |
| `collection.plugins` | `{}` | Exact npm-style owner names mapped to complete `{ traces, metrics }` rules; no scope, prefix, or wildcard matching. |
| `traces.sampleRatio` | `1` | Parent-based root trace sampling ratio; does not sample metrics. |
| `serviceName`, `serviceVersion` | `dsh`, unset | Explicit resource identity; `OTEL_SERVICE_NAME` supplies the name when absent. |
| `maxQueueSize`, `maxExportBatchSize` | `2048`, `512` | Bounded span queue and batch counts. |
| `scheduledDelayMillis`, `exportTimeoutMillis` | `5000`, `5000` | Span batch delay and per-export timeout. |
| `metricIntervalMillis`, `metricCardinalityLimit` | `30000`, `2048` | Metric reader interval and SDK aggregation limit. |
| `maxActiveOperations`, `maxOperationNames` | `4096`, `256` | Helper lifetime and distinct owner/name limits; overflow skips collection. |

`OTEL_SDK_DISABLED=true` is a strong off even with explicit approval. `OTEL_TRACES_EXPORTER=none` and `OTEL_METRICS_EXPORTER=none` independently disable signals. These environment variables cannot enable an unapproved runtime. Enabled exporters accept only `otlp` and protocol `http/protobuf`; unsupported selections fail at configuration resolution. SDK exporter environment settings such as OTLP headers are handled by the standard exporters. No logs exporter is created. Resource detectors and arbitrary `OTEL_RESOURCE_ATTRIBUTES` are not enabled.

### Instrumentation

`run(owner, operation, fn, attributes?)` returns the original callback result, including native Promise identity, and rethrows the original exception. Promise fulfillment or rejection settles the operation. Use `start(owner, operation, attributes?)` for streams, then `handle.with(fn)` around each iterator action and `handle.end(outcome)` in cleanup. Outcomes are `success`, `error`, `cancelled`, and `timeout`; cancellation does not abort application work. Handles expose a standard OTel `SpanContext` when tracing is active.

`recordDuration(owner, operation, durationMs, outcome?)` records an already completed phase under the active host parent. It accepts only finite durations from 0 through 300000 milliseconds; invalid values are silently skipped. Spans end at the host's current time and start the reported duration earlier; metrics use that duration in seconds. No payload or arbitrary metadata is accepted. `selected(owner)` checks whether the open runtime collects either signal for an exact owner without allocating an operation. `recordInterval` accepts trusted bounded Host endpoints; its optional final recorder runs under that interval to preserve parent links for reported child intervals. That recorder is for instrumentation only, not application work.

Owners identify the plugin responsible for the work, not a runtime scope. Operation names must be source-authored or selected from trusted registration metadata, never interpolated arguments, paths, session IDs, or model content. Names allow ASCII letters, digits, spaces, underscore, period, slash, colon, and hyphen, start with a letter, and have at most 160 characters. Attributes allow only `kind` (standard span kind) and `retry` (boolean). A disabled owner leaves the nearest active parent intact, so enabled descendants still nest correctly. Metrics record count and duration at settlement independently of trace sampling.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [configuration resolver](src/index.ts) snapshots approval, environment, endpoint precedence, and bounds before the [runtime](src/runtime.ts) acquires resources. One active instance owns the process-global OTel context manager and selected providers. A second instance or conflicting global registration fails instead of replacing another provider. Failed activation awaits rollback of acquired providers before rejecting; process ownership remains reserved until that drain completes. Standard OTel API spans inherit helper contexts across asynchronous continuations. Cordis disposal stops helper collection, ends active handles as cancelled, disables owned globals, and awaits SDK shutdown before permitting a successor.

[Runtime tests](tests/runtime.spec.ts) exercise in-memory exporters, concurrent roots, disabled-owner parenting, standard API parenting, metrics-only owners, cancellation, capacity, off-state timers, and Cordis disposal. The [transport fixture](tests/transport.spec.ts) uses an ephemeral loopback listener to check separate trace and metric HTTP/protobuf requests. It does not contact a remote collector.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as performance collection does not add model-visible input or change model output.

#### KV Cache effect

None; instrumentation does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Collection is best-effort and memory-only.

- Owner filtering and safe metadata apply to this service's helpers. Independently installed third-party OTel instrumentation can emit arbitrary global-API spans or metrics outside these rules; enable only reviewed instrumentation.
- Span queue overflow, operation capacity limits, exporter failure, and process loss can drop data. Stable diagnostics use OTel `diag` without raw errors; no diagnostic logger is installed automatically.
- Shutdown awaits SDK quiescence. Request timeouts and queue bounds constrain work, but there is no independently enforced total shutdown deadline or forced transport cancellation.
- Native Promises are observed; custom thenables and lazy iterators require manual handles. A manual handle must be ended by its caller; disposal closes remaining handles.
- Configuration is startup-only. No runtime resource metrics, auto-instrumentation, remote-context propagation, durable spool, retry policy override, or live settings UI is provided.

<a id="dev-note"></a>
### Dev Note

None.
