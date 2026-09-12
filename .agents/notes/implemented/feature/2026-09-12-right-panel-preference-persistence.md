# Agent Note: Durable right-panel user preferences

Status: implemented

English | [中文](2026-09-12-right-panel-preference-persistence.zh.md)

## Problem

The right panel's width preference and open/closed state lived only in browser memory: `ui-layout`'s `layoutInfo.rightbar` (the stored px, or the derived 45% first-open rule) and `ui-sidebar-right`'s per-surface `expanded` flag reset on every reload, so a user's adjusted panel width and chosen column state never survived a restart. The repository already owns a canonical per-user preference path — the settings capability (`ctx.settings` on the Host, `ctx.settingsScope` in the browser, persisted per identity by `settings-file`) — which themes, locale, paper, and conversation all use for exactly this kind of durable choice.

## Decision

The right panel keeps two durable sections, one per owning feature, and both packages follow the theme template: a shared schemastery schema module, a Host half that registers the namespace when a settings provider is composed, and a browser-side policy that bridges the live store and the durable section.

`ui-layout` owns `ui-layout` → `{ rightbar?: number | null }`. The browser `RightbarPreferenceSync` seeds the store from the section once it is ready (a stored width from a wider frame squeezes through the store's own clamp) and persists only at user commit points: the first materialization that fixes the derived width, and the drag release (`persistRightbar` in AppFrame's injected face — never mid-gesture writes). An equality guard in both directions keeps adoption and persistence from echoing, and a width committed while the section is still loading is flushed when it becomes ready.

`ui-sidebar-right` owns `ui-sidebar-right` → `{ rightbarExpanded?: boolean | null }`. The browser `PanelOpenPreference` wraps every minted surface store so only explicit gesture commits persist — a strip toggle, an expand button, any open — and the responsive auto-close (`setExpanded(surfaceKey, false)`, the sole false caller, when the frame cannot hold 300px beside a 400px center) never does. On a ready section the column reopens where the user left it, but only the first Session surface to materialize is restored (the session-independent surface that mounts while the connection settles never restores, so it cannot spend the restore the Session's column needs): a gesture marks the surface touched before the raw commit so the restore cannot race the gesture's own synchronous notify, any explicit gesture supersedes the restore for every surface, a surface minted later (a new Session) is its own and starts collapsed, and the seat's responsive rule still wins on a narrow frame. A General-section settings row (stepping in tens of px, mirroring the theme's font-size row) reads the live preference and writes through the same store action the drag handle uses.

"Unset" is a missing field, never an explicit `null`: the vendored schemastery fork treats a null default as no default, so nullable fields are expressed as `z.union([..., z.const(null)])` without a default, and both policies read `undefined` as "the product rule applies" (45% width, collapsed column).

## Alternatives considered

**Persisting through the layout store's localStorage option.** `client/store` has opt-in localStorage persistence, but the settings capability is the repository's per-user preference path: identity-scoped, schema-validated, Host-owned, and already used by every other preference. localStorage would have been browser-profile-local state outside that contract.

**One shared `ui-layout` namespace for width and open state.** The expanded flag is occupant-owned recorded business (`ui-sidebar-right` reports it to the frame; it never owns the value), so one namespace would cross the feature ownership rule every other preference namespace follows.

**Persisting expanded from the presentation reports.** The panel already reports `shown` through `ctx.layout`, but the report cannot distinguish a user collapse from the responsive auto-close; the gesture wrappers at the store instance are the only place that distinction exists.

## Consequences

A restarted app restores the user's right-panel width (or keeps the derived 45% rule) and reopens the column only where an explicit gesture left it open. The shipped web e2e contract that a reload returns the column to its collapsed default is updated in the same change: a reload now restores the durable open choice while the surface resets to its default page, and the sidebar e2e's expand helper tolerates the restore racing its expand click. Both settings namespaces are no-ops in compositions without the settings transport (remote browser pages stay process-local, memory mode). The settings document gains two registrant-owned namespaces; the General settings section shows one new width row. `ui-layout`'s AppFrame gained an inject face member (`persistRightbar`) and a `settingsScope` service dependency, and `ui-sidebar-right` gained a `settingsScope` dependency and wraps its minted store instances — the wrap is the documented chokepoint where future occupant-side durable facts would attach.