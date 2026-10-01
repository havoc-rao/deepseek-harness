# Agent Note: Fresh desktop boot injections and a serialized boot audit

Status: implemented

English | [中文](2026-10-02-desktop-boot-injection-staleness.zh.md)

## Problem

The Desktop shell captures the Web boot injections — the `__DSH_BOOT__` graph, the bootstrap script rows, and every plugin's batch URL with its per-artifact revision — once, from the Host's `ready` IPC event, and serves that snapshot to every page reload. The Host recomposes the graph whenever a plugin updates while the app runs: the plugin-manager reload remounts loader rows and the `client-hmr` stat poll republishes rebuilt artifacts, and each recomposition changes revisions and batch URLs. The Host's bundle table serves only the current generation plus one previous batch generation, and only the current revisions' single-resource URLs.

A reload after such an update boots against the stale snapshot, with two observed failure shapes (field crash reports of 2026-10-01, each one to two minutes after updating the same plugin):

- The stale batch and single-resource URLs are no longer in the bundle table: the batch script 404s (`bundle script … failed to load`), every row falls back to its one-resource URL, and the updated plugin's old-revision URL is gone too, so the boot audit reports `web boot: N entries did not activate` with full client-modules diagnostics.
- The stale URLs are still served (zero or one recomposition since the snapshot): the boot imports succeed, but the page's SSE client connects during boot and immediately receives the live graph, whose revisions differ from the snapshot. The reconciliation replaces each just-activated updated entry: `tearDownEntryFiber` deletes `entry.fiber`, then the re-import runs asynchronously. The boot audit, which ran outside the entries queue, sampled that mid-replacement state — an entry with no fiber and no recorded import error — and reported `import failed (see console for the import error)` with an error console that contained nothing about the failure.

The [fatal-diagnostics decision](../../architecture/2026-09-22-fatal-diagnostics-and-crash-reports.md) had documented the first shape as an unexplained stale-URL 404. The second shape is the same stale-snapshot root cause with a successful import: without the queue-ordered audit, the failure text names the console for an error that was never logged.

## Decision

- **The desktop Host republishes the boot injections whenever the client graph recomposes.** `installInjectionPublisher` subscribes to `clientModules.onGraphChanged` and sends a new `injections` IPC event carrying `ctx.webServer.collectIndexInjections()` — the same fresh-per-call collection the Web index uses. The shell replaces its cached snapshot on receipt; the `ready` event still carries the first. A page reload then boots against the exact graph the bundle table serves, closing both failure shapes at their source. No registry (or a composition without one) stays silent, and the startup snapshot remains the fallback.
- **The boot audit runs in the client entries queue.** `ClientEntries.audit` chains one operation behind every previously enqueued reconciliation, so a graph frame received while booting fully settles its replacements — including the refreshed entry fibers — before `assertEntriesActive` samples the Loader. A replacement that genuinely fails still leaves its latest recorded import error for the audit to report; only the false mid-teardown sample (`no fiber`, `no record`) is eliminated.

## Alternatives considered

**Retain stale generations on the Host bundle table.** Keeping discontinued revisions for a bounded time or count would serve old-snapshot pages, but it masks the stale snapshot instead of fixing it, grows memory with each update, and does nothing for the mid-replacement audit sample; a page older than the retention window fails exactly as before.

**Reload the page once when boot fails.** The shell cache stays stale, so the reload boots against the same snapshot and fails again; the loop needs the injection refresh to break it.

**Resolve a queue barrier before the audit instead of queueing the audit.** A barrier (`await this.queue` then audit) does not serialize: a queued replacement's synchronous prefix — deleting the fiber — already ran before the barrier's continuation, so the audit can still sample the teardown window.

**Defer SSE graph frames until after the boot audit.** This equally closes the race, but it changes live-sync timing for every boot and needs deferred-failure bookkeeping. Queueing the audit keeps reconciliation semantics untouched and lets the boot audit report the settled post-recovery state.

## Testing

| Evidence | Behaviour |
|---|---|
| [injections.spec.ts](../../../../apps/desktop-host/tests/injections.spec.ts) | The publisher sends one `injections` message per graph change with the fresh injection table and stays silent without a client module registry. |
| [host-process.spec.ts](../../../../apps/desktop/tests/host-process.spec.ts) | The `injections` event is delivered to the shell callback over private IPC; malformed payloads reject the host as invalid events. |
| [boot-client.client.spec.ts](../../../../packages/client/web/tests/boot-client.client.spec.ts) | While the boot waits on a gated first bundle, a graph replacement is queued; the audit stays unsettled until the replacement's bundle arrives, then reports every entry active. The test fails against an unsynchronized audit. |
| [main-startup.spec.ts](../../../../apps/desktop/tests/main-startup.spec.ts) | The boot IPC still resolves with the shell's injection snapshot once the Host is ready. |

## Consequences

- A reload after a plugin update boots against the current graph: the stale-revision bundle 404s and the mid-replacement `see console` audit are gone.
- A graph frame that arrives during boot delays the boot audit by at most the replacement's download; a failed replacement is still reported loudly with its latest recorded import error.
- The Web variant already collects injections per request and gains the serialized audit; only the Desktop shell had the stale snapshot.
- The desktop shell refreshes injections only while its Host runs; a replacement Host re-establishes the snapshot on its `ready` event.
