---
description: "Integrate optional OpenTelemetry performance collection into extensions in other workspaces, with SigNoz as an example backend."
---

# Connect an extension to SigNoz

English | [中文](signoz.zh.md)

## Summary

Instrument an extension's operations and verify selective export to an approved OTLP collector. This guide gives another workspace's implementation agent a supported starting point; it does not claim that an external extension or a production SigNoz deployment has been tested. The DSH runtime uses standard OpenTelemetry HTTP/protobuf, so another compatible backend can replace SigNoz.

## Table of Contents

- [Identify the execution process](#identify-the-execution-process)
- [Instrument a Host plugin](#instrument-a-host-plugin)
- [Approve a deployment overlay](#approve-a-deployment-overlay)
- [Verify collection and privacy](#verify-collection-and-privacy)
- [Other-workspace agent task checklist](#other-workspace-agent-task-checklist)
- [Further exploration](#further-exploration)

-----

<a id="identify-the-execution-process"></a>
## Identify the execution process

Read the target workspace's source, manifest, and launch configuration first. Choose the integration by where the work executes, not where its repository lives.

| Execution location | Integration responsibility |
|---|---|
| Cordis Host plugin in the DSH process | Read optional `ctx.get('observability')`; the Host mounts and owns the runtime. |
| Independent Node or other-language process | Own an opt-in OTel SDK, context propagation, exporters, and shutdown in that process. DSH selection does not instrument it. |
| Browser or client plugin | The reviewed [`sessions.observeCreation` capability](../../packages/api/session-controller/README.md#client-references) is scoped to `dsh-enhanced-workspace` creation. Readiness means object-layer `openState === 'open'`, not DOM readiness. Observe other Host work through the Host plugin; do not import the Node runtime into a client bundle. |

A separate process needs its own service identity and a collector URL reachable from its host. `127.0.0.1` refers to that process's machine or network namespace; a tunnel opened on the DSH machine is not automatically available elsewhere. DSH supplies no automatic remote-context propagation. Cross-process trace parenting needs a separately reviewed propagation design.

For an independent Node process, the workspace agent should inspect its existing OTel setup before choosing standard SDK packages such as `@opentelemetry/sdk-node` and the HTTP/protobuf exporters. Gate SDK initialization behind that process's explicit opt-in, configure its own stable `service.name` and reachable endpoint, and await its SDK shutdown through the existing process lifecycle. Propagate W3C trace context only across reviewed, trusted hops when cross-process parenting is required. These are implementation responsibilities, not a tested external-process recipe; DSH flags and helper filters do not govern that SDK.

A README or `dist` artifact containing only diagnostics does not establish a functional product entry point. Identify actual work before adding instrumentation; do not infer or document a specific integration from a diagnostic artifact. Edit maintained source, not generated `dist` or `lib` output, and rebuild through the target workspace's supported build.

-----

<a id="instrument-a-host-plugin"></a>
## Instrument a Host plugin

Use the [runtime reference](../../packages/telemetry/observability-otel/README.md) for configuration, metadata rules, and lifecycle guarantees. The following compiled example demonstrates optional service access for synchronous work and native Promises; it is not an implementation of a particular extension.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-observability-otel'

const owner = '@example/dsh-extension'

export function observeWork<T>(ctx: Context, work: () => T): T {
  const observation = ctx.get('observability')
  return observation === undefined
    ? work()
    : observation.run(owner, 'extension.work', work, { kind: 'internal' })
}
```

The type-only import loads Cordis's type augmentation without importing the runtime at execution. An optional consumer declares the observability package as an optional peer and a development dependency for compilation; the Host deployment declares a runtime dependency so its Loader can resolve the mounted plugin. In this repository, use `workspace:*` for DSH dependencies. In another workspace, use compatible released versions or that workspace's actual linked-package policy, not unresolvable `workspace:*` ranges. Keep the import Host-only; a static value or side-effect import defeats runtime optionality.

Use the extension's exact owning npm package name, such as `@example/dsh-extension`, consistently in code and collection rules. Owners are not scopes, provider routes, or session identifiers. Operation names must be stable source-authored names. Only `kind` and `retry` are accepted helper metadata; do not add arguments, paths, body content, identifiers, results, private attributes, raw errors, or stacks.

### Tools and model adapters

For tools dispatched by the DSH tool registry, set `telemetryOwner` on the `defineTool` options or `ToolDefinition`. For an LLM adapter, pass `{ telemetryOwner: owner }` as the third argument to `ctx.llm.registerAdapter(providers, adapter, options)`. These registry paths already observe dispatch and stream lifetimes; do not wrap the same lifetime again merely to enable collection. Unlabelled registrations are not assigned an inferred owner. See the [tool reference](../../packages/core/tools/README.md) and [LLM reference](../../packages/llm/llm/README.md).

### Streams and terminal outcomes

`run` observes native `Promise` settlement, not custom thenables or lazy iterator consumption. Creating a stream inside `run` does not measure its full lifetime. For custom streaming work, use `start` and activate the handle with `handle.with` around stream creation, every `next`, and cleanup through `return`; include `throw` if the iterator protocol exposes it. End the handle exactly once in a `finally` path after cleanup, including early consumer exit and cleanup failure.

Classify completion from the application's terminal protocol: a normally exhausted iterator can still carry an error, cancellation, or timeout terminal record. Map those records to `error`, `cancelled`, or `timeout`; use `success` only for successful completion. Preserve the original values and errors, cancellation behavior, and iterator cleanup. Ending a handle does not abort application work. Prefer the existing registry integration to copying a hand-written stream wrapper; a custom wrapper needs focused tests for its own protocol.

The helper measures settled operation count and duration, not first-output latency or runtime resource usage. Configuration is startup-only. The Host's Cordis disposal owns provider shutdown; per-request timeouts do not impose a total shutdown deadline. Do not install a second global OTel provider inside a plugin sharing this process. Raw global OTel API calls can bypass helper owner selection and metadata filtering, so review them separately.

-----

<a id="approve-a-deployment-overlay"></a>
## Approve a deployment overlay

Ask the operator to approve signals, exact owners, destination, and retention before exporting. The following minimal overlay template selects only the example owner; replace it with the target extension's actual package name. The local endpoint is explicit and requires a collector or tunnel reachable from the Host process.

```yaml
- insert:
    - id: observability
      name: '@deepseek-ai/dsh-observability-otel'
      config:
        enabled: true
        endpoint: http://127.0.0.1:14318
        serviceName: example-extension-host
        collection:
          default: { traces: false, metrics: false }
          plugins:
            '@example/dsh-extension': { traces: true, metrics: true }
```

The template's configuration resolves with an empty environment snapshot; it does not demonstrate Loader composition or remote ingestion. Adapt it to the target profile without modifying shipped defaults. The Host must have a compatible runtime package installed, and an existing `observability` entry must be updated rather than duplicated. Follow the [operator guide](../user/guide/observability.md) for profile validation, restart, tunnel setup, and ingestion troubleshooting.

Collection defaults off. Each exact owner rule includes both boolean signals, allowing metrics-only or traces-only collection; global signal switches can disable either independently. Trace sampling does not sample metrics. Environment variables cannot authorize an unapproved runtime, and `OTEL_SDK_DISABLED=true` prevents activation. Do not apply this template to an active profile without operator approval.

-----

<a id="verify-collection-and-privacy"></a>
## Verify collection and privacy

Test with disposable inputs and an isolated process. Helper filtering does not authorize Session-log uploads, and separate product or Session telemetry remains independently configured.

- With the runtime absent and with collection disabled, preserve application behavior and verify zero exports; disabled collection allocates no provider, exporter, interval, or timeout.
- With collection enabled, check selected owners, excluded owners, metrics-only selection, and signal switches. Check concurrent roots and nested parenting, including an excluded parent with a selected descendant.
- Exercise success, rejection, cancellation, timeout, early stream return, terminal error records, and cleanup failure. Verify no retained handles and unchanged results or exceptions.
- Decode exported traces and metrics to check that arguments, bodies, paths, private identifiers, results, exception messages, and stacks are absent. Review separately any raw global OTel instrumentation or independent-process SDK.
- Check real ingestion in SigNoz by service name, time range, `dsh.owner`, `dsh.operation`, and `dsh.outcome`, and by `dsh.operation.count` and `dsh.operation.duration` (seconds). An HTTP 200 response alone does not establish ingestion or visibility in the backend.

Export is best-effort: queue and capacity limits, export failures, and process loss can drop records. Allow for batching and metric intervals. Name the operator responsible for real backend verification when a collector is unavailable; do not label an unexecuted recipe as tested.

-----

<a id="other-workspace-agent-task-checklist"></a>
## Other-workspace agent task checklist

Copy this checklist into the target workspace's agent task and fill in deployment-specific values.

1. Inspect the actual source, manifest, Host/client split, and supported launch path; identify the package owner and independent processes.
2. Read the linked runtime and registry references; choose optional Host helpers, registry owner metadata, or a separately owned process SDK.
3. Implement only in the target workspace, keep runtime imports Host-only, and retain working behavior when observability is absent or disabled.
4. Add lifetime, concurrency, cancellation, off-state, selective-collection, and privacy checks appropriate to that integration.
5. Prepare an unapplied profile overlay with the approved owner and reachable endpoint; do not change active or shipped profiles automatically.
6. Return changed files, commands actually executed, observed results, unverified backend ingestion, and the operator's remaining restart and verification steps.

-----

<a id="further-exploration"></a>
## Further exploration

- [Observability runtime API and limitations](../../packages/telemetry/observability-otel/README.md)
- [Operator configuration and SigNoz inspection](../user/guide/observability.md)
- [Extension authoring](../cookbook/extension-cookbook.md)
- [Tool authoring](../cookbook/adding-a-tool.md) and [LLM adapter authoring](../cookbook/adding-an-llm-adapter.md)

### Dev Note

None.
