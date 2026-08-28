# Agent Note: electron main-process shortcut router

Status: implemented

English | [中文](2026-08-28-electron-main-process-shortcut-router.zh.md)

## Problem

The desktop shell (apps/electron) intercepts Cmd+W in `before-input-event`
and shows the close-confirmation dialog (apps/electron/src/window.ts). The
renderer never receives the key, and nothing outside window.ts can change
what the key does: no main-process plugin has an extension point to claim
the shortcut while the confirmation dialog stays the default. A feature that
wants Cmd+W to do something context-sensitive (for example, close an active
tab when one exists) would otherwise have to edit the window code itself.

## Decision

`apps/electron/src/shortcuts.ts` introduces a typed `ShortcutRouter` service
on the electron-profile host context: `desktopShortcuts?` merges into the
Cordis `Context` interface, and `provideDesktopShortcuts` installs it before
the tree mounts (apps/electron/src/host.ts), mirroring how dsh-cmdline
provides `cmdlineArgs`. A handler registers per shortcut and the registration
returns its disposer (the register-returns-disposer rule). `route` runs the
shortcut's handlers in registration order and resolves
`'claimed' | 'unclaimed'`: `true` claims the press, `false`/`undefined`
passes to the next handler, and promise results are awaited in order.

window.ts routes the intercepted Cmd+W through the router before the
close-confirmation fallback: a claim leaves the window untouched, an
unclaimed press (or a throwing handler) keeps the existing confirm dialog
(the [Cmd+W close-confirmation decision](../feature/2026-08-24-electron-close-confirmation.md)).
A `routingCloseShortcut` guard drops presses while a route is in flight,
mirroring the existing `confirmingClose` guard. The only known shortcut is
`'cmd-w'`; the `DesktopShortcut` union is where future ones mount.

The renderer path stays closed. A page-side consumer needs a preload/IPC
bridge — contextBridge over the existing sandboxed, context-isolated web
contents plus `webContents.send` — which widens the security surface and has
no consumer today. The router is where that bridge registers later.

## Alternatives considered

**Re-dispatch Cmd+W into the renderer with `sendInputEvent` and let the page
decide.** Rejected: the page has no keybinding system or consumer yet, the
close-confirmation default would depend on a slow "did the page consume it"
round-trip, and the renderer contract would change without an owner.

**A plain callback parameter on `createWindow`.** Rejected: it serves only
the single caller in main.ts and is invisible to plugins; a service on the
host context is discoverable by any electron-profile plugin
(`ctx.desktopShortcuts`) and matches the registrations-are-effects
convention.

**Remove the Cmd+W interception and rely on page JavaScript.** Rejected: the
app has no application menu, so the before-input-event handler is the only
close-shortcut control — dropping it would make Cmd+W close the window
without the session-ending confirmation.

## Consequences

- Default behavior is unchanged: Cmd+W still confirms before closing unless
  a handler claims it.
- Main-process plugins can claim shell shortcuts without touching window.ts;
  new shell shortcuts extend the `DesktopShortcut` union.
- A renderer-side claim stays deferred to a preload/IPC bridge with a real
  consumer; the router defines the bridge's registration point.
- An async handler delays the fallback dialog by its own latency; handlers
  are main-process plugin code, so the delay is bounded by plugins, not the
  renderer.