# Agent Note: Open-in-app workspace target providers

Status: implemented

English | [中文](2026-09-14-open-in-app-workspace-target-providers.zh.md)

## Problem

The Session-header Open In split button always resolved a *local* application on the session's `cwd`. A remote deployment such as dsh-remote mirrors a remote host's workspace into a local directory and sets the session cwd inside that mirror, so the button opened the mirror copy in a local editor instead of the real remote directory over Remote-SSH. The host routes had no extension point for a plugin that owns such a path, and the browser read availability once per page rather than per workspace path, so there was nowhere for a claimed target's catalog and remote semantics to arrive.

## Decision

**`dsh-host-open-in-app` publishes a host-side provider registry as the service `ctx.openInApp`.** [`src/provider.ts`](../../../../packages/host/open-in-app/src/provider.ts) defines the types and owns `OpenInAppProviderRegistry`, which `apply` publishes with `ctx.provide('openInApp', registry.service)`. The service has one method, `registerProvider(provider)`, returning a disposer that unregisters that provider; the registering plugin wires the disposer through its own `ctx.effect` so the provider leaves with it. Two providers with the same `id` throw at the registration site. Other plugins read the service with `ctx.get('openInApp')` and degrade when it is absent, so no browser half registers anything.

A provider is `{ id, resolve, launch }`. `resolve({ path, sessionId? })` answers `OpenInAppTarget | null`, with `Target = { provider, label, apps }`: `provider` equals the provider's own `id`, `label` is the human source identifier (for example `root@host:/srv/app`), and `apps` is the catalog ids available on that target in menu order. `null` declines the path, leaving it to the built-in local behavior. `launch({ app, path, sessionId? })` opens `app` on the claimed target.

**The routes consult providers before the built-in resolution.** `GET /open-in-app/apps?path=<absolute>&sessionId=<id>` answers `{ apps: string[], target: { provider: string, label: string } | null }`: a claim serves the provider's catalog and target, and any other request — including every request without a `path` — serves the built-in catalog with `target: null`. `POST /open-in-app/open` now takes `{ app, path, sessionId? }`, validates `app` against the claimed target's `apps`, and launches a claimed path only through `provider.launch`. A claimed launch failure answers 502 and never falls back to opening the mirror path with a local application. The provider `resolve` deadline is the validated `providerTimeoutMs` Config field; a provider that throws or misses it counts as declining the path, so a broken provider cannot fail the apps route or hang the button. The icon route, the connection trust fence, the `application/json` media-type check, the 64 KiB ceiling, and the absolute-existing-directory check stay unchanged.

**The browser half reads availability per workspace path.** [`src/client/controller.ts`](../../../../packages/client/ui-open-in-app/src/client/controller.ts) publishes a snapshot map keyed by workspace path, shares concurrent reads of one path, reads each path once per page, and degrades a failed read to an empty catalog. The component asks the controller for its `cwd` whenever the cwd changes and publishes the claimed target alongside the apps, so the tooltip names the remote source (`open.tooltipRemote`, `open.titleRemote` in the bilingual `open-in-app` namespace) while `target === null` keeps the existing local appearance.

## Alternatives considered

**Register providers from the browser half.** Rejected: path ownership and launching live on the host, where the real remote directory and the editor are; browser registration would need a wire protocol to reach them and could not launch anything itself.

**A Typert Remote method instead of the routes.** Rejected: the package deliberately serves raw `webServer` routes over one host resolution pass, and a provider is same-process host code. A Remote would add a transport and a generated type surface for no new reach.

**A `Target` without the `provider` field, stamped by the host.** Rejected: the provider already knows its own id and returning the complete target keeps one shape across `resolve` and the wire. The host trusts the returned `provider`, which the shape documents as equal to the provider's `id`.

**Falling back to a local launch when a claimed launch fails.** Rejected: opening the local mirror path is exactly the wrong outcome when a remote plugin claimed it. The route reports the failure instead and the browser shows its error state.

**Treating a provider error or timeout as a route error.** Rejected: the extension point must not let one broken provider take down the button. Declining is the documented degradation, and the remaining providers still get their turn.

**A hardcoded resolve deadline.** Rejected: the useful deadline varies with the provider's transport, so `providerTimeoutMs` is a validated Config field changeable from cordis.yml rather than a constant.

## Consequences

A host plugin can claim workspace paths and own their launches, which is what dsh-remote (a separate repository) implements. The package's Config gains the required `providerTimeoutMs` field, so existing external compositions that mount the package must set it. Providers can only offer application ids already in `OPEN_IN_APP_CATALOG`: the icon route and the browser dictionaries are built in, so an id the dictionaries cannot name stays invisible. Availability is now read once per workspace path per page instead of once per page, and a Session header shows the target of its own cwd. Provider resolution failures and deadlines degrade to the built-in local target, which keeps the button usable but means a transiently failing provider can briefly expose local behavior for a remote path.
