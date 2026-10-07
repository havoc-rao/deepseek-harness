# OTel reporting

English | [中文](otel.zh.md)

The [OTel plugin](../../packages/telemetry/otel/README.md) registers `ctx.otel`, a shared factory for independent ordinary-event and Session-log channels. It owns transport and SDK batching implementations. Business consumers inject the service, supply explicit transport/resource/scope options, and own each returned channel's shutdown.

UI feedback reaches the Session feedback services through their existing Remote APIs. Feedback recording authorizes the Session adapter's canonical-prefix capture and redaction before it reports through an OTel channel. Ordinary product consumers submit selected fields through the product adapter. The shared service has no automatic identity or capture policy, and channels never share queues or requests.

The [product adapter](../../packages/host/product-telemetry-otel/README.md) and [Session adapter](../../packages/session/session-telemetry-otel/README.md) retain their deployment configuration and disposal deadlines. Consumers must not reuse a channel after shutdown. Mounting only the OTel service allocates no provider or transport.

The separate [performance runtime](../../packages/telemetry/observability-otel/README.md) registers `ctx.observability` for opt-in traces and metrics. Its plugin-owner selection does not authorize Session uploads or alter existing log channels. Tools and model adapters declare their own telemetry owner; unlabelled registrations are not attributed to a guessed plugin. Gateway operations use the Gateway component owner, not the downstream controller owner.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxobservability--observability"></a>

### `ctx.observability` — `Observability`

Startup-only global runtime; disposal drains and unregisters only providers it owns.

```ts cordis-catalog
/**
 * Observe callback completion without recording arguments, results, or errors.
 * @param owner - Exact plugin package name, not scope.
 * @param operation - Stable source-authored operation name.
 * @param fn - Callback whose value and exception are preserved.
 * @param attributes - Allowlisted stable metadata only.
 * @returns Original callback value, including native Promise identity.
 */
run<T>(owner: string, operation: string, fn: () => T, attributes?: SafeAttributes): T

/**
 * Check whether an exact owner has any enabled collection signal without allocating an operation.
 * @param owner - Exact plugin package name.
 * @returns Whether the active runtime collects traces or metrics for this owner.
 */
selected(owner: string): boolean

/**
 * Record a completed duration under the active parent, without accepting payload metadata.
 * Invalid durations are silently skipped; span end time is now and start time is now minus duration.
 * @param owner - Exact plugin package name.
 * @param operation - Stable source-authored operation name.
 * @param durationMs - Finite duration from 0 through 300000 milliseconds, inclusive.
 * @param outcome - Stable terminal classification; defaults to success.
 * @returns Nothing; collection is best-effort and does not throw on instrumentation failures.
 */
recordDuration(owner: string, operation: string, durationMs: number, outcome?: Outcome): void

/**
 * Record trusted Host Unix endpoints without payload attributes; invalid intervals are skipped.
 * @param owner - Exact source-authored owner.
 * @param operation - Fixed source-authored operation name.
 * @param startTimeUnixMs - Nonnegative finite Unix milliseconds.
 * @param endTimeUnixMs - Finite endpoint not earlier than start, at most 300000ms later.
 * @param outcome - Independent phase outcome; defaults to success.
 * @param children - Optional trusted recorder for nested intervals; application work must not run here.
 */
recordInterval(owner: string, operation: string, startTimeUnixMs: number, endTimeUnixMs: number, outcome?: Outcome, children?: () => void): void

/**
 * Begin a manual lifetime; activate each stream iterator call with handle.with().
 * @param owner - Exact plugin package name.
 * @param operation - Stable source-authored operation name.
 * @param attributes - Allowlisted stable metadata only.
 * @returns Handle to end on success, error, cancellation, or timeout.
 */
start(owner: string, operation: string, attributes?: SafeAttributes): Operation
```

Source: [`packages/telemetry/observability-otel/src/index.ts`](../../packages/telemetry/observability-otel/src/index.ts)

<a id="ctxotel--otel"></a>

### `ctx.otel` — `OTel`

Shared transport provider. Mounting creates no queue, identity, or network connection.

```ts cordis-catalog
/**
 * Create an independent ordinary-event channel with count-based batching.
 * The injected consumer must drain it during its fiber disposal.
 * @param options - transport, scope, resource, queue, and diagnostic settings selected by the consumer.
 * @returns the caller-owned channel; no state is shared with other channels.
 */
createEventReporter(options: EventLogOptions): EventLogReporter

/**
 * Create an independent byte-bounded Session-log channel.
 * Authorization and redaction precede reporting; the consumer owns shutdown and its outer deadline.
 * @param options - transport, scope, resource, queue, and diagnostic settings selected by the consumer.
 * @returns the caller-owned channel, preserving complete accepted events within the request byte ceiling.
 */
createSessionLogReporter(options: SessionLogOptions): SessionLogReporter
```

Source: [`packages/telemetry/otel/src/index.ts`](../../packages/telemetry/otel/src/index.ts)
<!-- END GENERATED cordis-surface -->
