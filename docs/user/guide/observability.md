---
description: "Configure optional OpenTelemetry performance traces and metrics for selected DSH plugins, and inspect them in SigNoz."
---

# Collect performance traces and metrics

English | [中文](observability.zh.md)

## Summary

Send selected plugin operation counts, durations, and traces to an OpenTelemetry collector such as SigNoz. Collection is optional and off by default. Approve the destination and plugin selection before enabling it; the example does not authorize collection from every plugin or automatically enable collection in an already running DSH process.

## Table of Contents

- [Prepare the collector and runtime](#prepare-the-collector-and-runtime)
- [Select plugins and signals](#select-plugins-and-signals)
- [Validate and restart](#validate-and-restart)
- [Inspect collection and troubleshoot](#inspect-collection-and-troubleshoot)
- [Disable collection](#disable-collection)
- [Further exploration](#further-exploration)

-----

<a id="prepare-the-collector-and-runtime"></a>
## Prepare the collector and runtime

You need a collector accepting OTLP HTTP/protobuf and a DSH runtime that includes the optional [observability plugin](../../../packages/telemetry/observability-otel/README.md). For a source checkout, use the full build described in the [development guide](../../development.md), not just the Web frontend build: a frontend-only rebuild does not add the plugin to the shipped runtime. Refreshing a browser does not activate server-side collection.

Use a collector you control, or explicitly approve an external destination. Do not expose an unauthenticated collector or SigNoz UI to the public internet. This guide assumes the collector and UI already exist; their installation and access policy belong to your deployment operator.

For a remote SigNoz deployment, your deployment operator can adapt this SSH tunnel template. The template assumes the remote OTLP HTTP port is `4318` and the UI port is `8080`; replace `user@collector.example.com` and remote ports to match the deployment. This is a manual verification step owned by that operator, not an automatic DSH setup command.

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:14318:127.0.0.1:4318 \
  -L 127.0.0.1:18080:127.0.0.1:8080 \
  user@collector.example.com
```

Keep the tunnel open. DSH on your local machine can use `http://127.0.0.1:14318` as its base OTLP endpoint; open `http://127.0.0.1:18080` for the SigNoz UI. These local ports are examples, not runtime defaults. A DSH process on another machine needs its own reachable collector URL.

-----

<a id="select-plugins-and-signals"></a>
## Select plugins and signals

Review the [example overlay](../../../apps/cli/config/examples/observability.patch.yml) before applying it. It enables the runtime with service name `dsh-local`, leaves unlisted owners off, and selects these exact plugin owners:

| Owner | Traces | Metrics |
|---|---|---|
| `@deepseek-ai/dsh-api-gateway` | `true` | `true` |
| `@deepseek-ai/dsh-tool-fs` | `true` | `true` |
| `@deepseek-ai/dsh-tool-bash` | `false` | `true` |
| `@deepseek-ai/dsh-llm-deepseek` | `true` | `true` |
| `@deepseek-ai/dsh-llm-pi-ai` | `true` | `true` |

The API Gateway records invocations and streams; it is not a controller. File and bash tools report under their owning tool plugins. DeepSeek-family model routes use the DeepSeek owner; pi-ai routes use the pi-ai owner. Selecting an owner does not install it or make unused operations run.

Copy the overlay to your own configuration location if you need a different policy. Each owner rule must include both `traces` and `metrics` as YAML booleans, not quoted strings. Exact package names select owners; wildcards, prefixes, and scopes do not. Keep `collection.default` off unless you explicitly approve broader collection. Global `traces.enabled` and `metrics.enabled` switches can disable a signal independently; trace sampling does not sample metrics.

DSH helper records contain stable owner and operation names, outcomes, timing, and optional retry metadata. They omit tool arguments, results, exception messages, and stacks. These restrictions and owner selection apply to DSH helpers, not independently installed third-party instrumentation using the global OTel API. Review such instrumentation separately. Enabling collection consumes resources; no zero-overhead guarantee applies.

-----

<a id="validate-and-restart"></a>
## Validate and restart

From the checkout root, inspect the merged Web profile without starting a server:

```sh
dsh --profile web --patch apps/cli/config/examples/observability.patch.yml --dump-config
```

Confirm that the merged configuration includes the `observability` entry and your intended rules. `--dump-config` checks profile composition; it does not launch the runtime, connect to the collector, or demonstrate ingestion.

The process owner must then stop and restart the intended DSH application with the approved overlay and endpoint. The following launch template is a manual verification step for that owner; do not run it alongside an existing Web server as a substitute for restarting that server.

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318 \
  dsh --profile web --patch apps/cli/config/examples/observability.patch.yml
```

Configuration and environment are read at startup. There is no live observability settings UI. A base endpoint gets `/v1/traces` and `/v1/metrics` appended; signal-specific endpoints must be complete URLs. Without an explicit endpoint for each enabled signal, startup fails. `OTEL_SDK_DISABLED=true` prevents activation even with `enabled: true`; environment settings alone cannot enable an unapproved runtime.

-----

<a id="inspect-collection-and-troubleshoot"></a>
## Inspect collection and troubleshoot

For manual ingestion verification, the process owner should prefer a separate supported headless profile run with the approved overlay and disposable inputs. Exercise a selected tool or model route. If verifying through the restarted Web application, use an isolated process without unrelated sessions: owner selection applies across that process, not just one task. Do not enable collection for real user data without separate approval.

In SigNoz, select service `dsh-local` (or your configured `serviceName`) and the task's time range. Traces expose `dsh.owner`, `dsh.operation`, and `dsh.outcome`. Metrics are `dsh.operation.count` and `dsh.operation.duration`, with duration in seconds. Bash is metrics-only in the example, so a missing bash span is expected. Allow for batching and metric export intervals; see the [runtime configuration reference](../../../packages/telemetry/observability-otel/README.md) for timing and limits.

If no data appears, check the tunnel, collector HTTP/protobuf receiver, endpoint, service filter, time range, selected owner, and strong-off environment settings. If startup rejects configuration, use real booleans, complete rules, and only documented fields. If a plugin cannot resolve after a source update, check that the full runtime build includes it. Collection is best-effort: queue overflow, capacity limits, exporter failures, and process loss can drop data.

-----

<a id="disable-collection"></a>
## Disable collection

Remove the overlay, set its `enabled` field to `false`, or start with `OTEL_SDK_DISABLED=true`, then restart the process. Editing configuration or changing a shell variable does not affect a running process. Disabled collection creates no provider, exporter, interval, or timeout. Disabling DSH collection does not delete data already retained by the collector.

-----

<a id="further-exploration"></a>
## Further exploration

- [Observability configuration, filtering, and limitations](../../../packages/telemetry/observability-otel/README.md)
- [Separate OTel log transport](../../../packages/telemetry/otel/README.md)
- [CLI profiles and overlays](../../../apps/cli/README.md)
- [External plugin instrumentation](../../extensions/signoz.md) — self-service integration from another workspace.

### Dev Note

None.
