# Agent Note: Renderer shortcut bridge and middle-click tab close

Status: implemented

English | [中文](2026-09-12-renderer-shortcut-bridge.zh.md)

## Problem

Cmd+W is intercepted in the Electron main process before the renderer ever sees the key (apps/electron/src/window.ts) and routed through the `desktopShortcuts` router; a page-side consumer had no way to claim the press — the [shortcut router note](2026-08-28-electron-main-process-shortcut-router.md) recorded the renderer path as closed, pending the preload/IPC bridge it names. dsh-better-sidebar (v0.20.x) wants Cmd+W to close the right sidebar's active tab when one exists and leave the press unclaimed otherwise, so the window keeps its close-confirmation dialog. Separately, closing a dockkit tab offered only the hover × control and the context menu: a middle click on a tab chip was dead — worse, it started a drag.

## Decision

**A preload/IPC bridge lets the page claim shell shortcuts.** `apps/electron/src/preload.ts` exposes `window.dshDesktopShell.onShortcut(name, handler)` through contextBridge on the existing sandboxed, context-isolated web contents, and ships as a CommonJS artifact (`lib/preload.cjs`, a second tsdown pass; `sandbox: true` preloads can only `require('electron')`). The main process registers one 'cmd-w' router handler per window (`apps/electron/src/renderer-shortcuts.ts`): a destroyed or still-loading window answers unclaimed without asking; otherwise the handler sends `dsh:shell-shortcut` (`{ name, requestId }`) to that window's webContents and waits for the preload's `dsh:shell-shortcut-claim` (`{ name, requestId, claimed }`), with `claimed = handler() === true`. The preload always replies — no handler, or a throwing handler, answers `false` — and an unanswered ask settles as unclaimed after 1.5s, so a dead renderer never hangs the window close. Window `closed` unregisters the handler, settles pending asks, and drops the claim listener.

The bridge answers from `handler() === true`, the router's claim semantics, so an unclaimed press keeps `confirmClose` untouched. Each window owns its bridge; replies route by request id, so other windows ignore them.

**A middle click closes a tab chip.** In ui-dockkit, a chip's `onPointerDown` now returns for `button === 1` as well as `button === 2` (no drag), and the chip answers `onAuxClick` for `button === 1` with `preventDefault` (Chromium's middle-click autoscroll), `stopPropagation` (the chip reports its own intents), and `onCloseTab(tab.id)` when the embedder's `canCloseTab` allows. The floating layer's title chip and header do the same (packages/client/ui-dockkit/src/components/TabPanel.tsx, FloatLayer.tsx).

## Alternatives considered

**The page receives the real key.** Not intercepting Cmd+W, or re-dispatching it with `sendInputEvent`, hands the decision to a page with no keybinding system and makes the confirmation dialog depend on a slow round-trip; the shortcut router note already rejected this. The bridge keeps main-process arbitration and adds only a boolean reply.

**No timeout on an ask.** A renderer that stops answering would hang every window close. The 1.5s deadline settles the press as unclaimed, the dialog's default.

**One global claim channel without per-window state.** A single pending map could not tell which window a reply belonged to; each window owns its bridge and replies carry the ask's request id.

**Suppress autoscroll on pointerdown.** Chromium starts autoscroll on the middle-button `mousedown`, before `auxclick` fires, so only a `preventDefault` on the press itself can reliably stop it. The convention here answers on the click gesture (`auxclick`) as fixed by the consumer contract; the `preventDefault` on `auxclick` covers browsers that consult it.

## Consequences

The page gains a claim channel for shell shortcuts: dsh-better-sidebar closes the right sidebar's active tab on Cmd+W and the window keeps its confirmation dialog otherwise. The renderer's input surface widens by one contextBridge API on an already sandboxed, host-origin page, and the main process accepts only a boolean claim per request. A page that stops answering adds up to 1.5s before the dialog appears. The middle-click close replaces a dead (drag-starting) press on dockkit chips, for floating titles too, with closability still owned by the embedder's `canCloseTab`; the hover × control and the context menu remain. The apps/desktop-host subprocess layout (`dsh-app://`) is the other deployment surface and does not expose this bridge; the apps/electron README records the contract for the v0.20.x consumer.