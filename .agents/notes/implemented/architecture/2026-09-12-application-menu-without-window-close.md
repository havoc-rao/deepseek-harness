# Agent Note: Application menu without a window-close shortcut

Status: implemented

English | [中文](2026-09-12-application-menu-without-window-close.zh.md)

## Problem

apps/electron installs no application menu, so Electron's default menu applies: on macOS its File menu carries Close Window (Cmd+W, role 'close'). A menu accelerator can fire before the webContents before-input-event that window.ts relies on, so Cmd+W could close the window even when the page claimed the press through the [renderer shortcut bridge](2026-09-12-renderer-shortcut-bridge.md). Semantics A (the dsh-better-sidebar consumer, v0.20.x) makes Cmd+W never open the close-confirmation dialog: close the active tab when one exists, else collapse the right sidebar or do nothing — the page always claims. The default menu was the one conduit that could bypass that contract; the bridge alone could not prevent it.

## Decision

main.ts calls `Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate()))` once the app is ready, and the template is a testable export (`apps/electron/src/menu.ts`) built from roles only, so labels and accelerators stay Electron's platform-localized ones and no copy is hardcoded. macOS gets `appMenu` (About / Services / Hide / Quit — Cmd+Q stays the quit path), `editMenu` (cut / copy / paste for terminal and editor fields), `viewMenu`, `windowMenu`, and an empty `help` menu; Windows and Linux get `fileMenu` (there it holds Quit only), `editMenu`, `viewMenu`, and `windowMenu`. `fileMenu` is deliberately absent on macOS: there it contains Close Window, the very item the template forbids, and the Windows/Linux `fileMenu` carries no close role, so Ctrl+W cannot appear either. The unit suite walks the template tree recursively and rejects any role 'close' item or accelerator matching CmdOrCtrl+W on every platform; it also pins the role sets (macOS App menu first, Edit roles present, no hardcoded labels or accelerators).

The close confirmation therefore lives on exactly one path: before-input-event → shortcut router unclaimed. With semantics A the page always claims, so the dialog stays reachable only for a destroyed, still-loading, or silent page, or a missing handler.

## Alternatives considered

**Keep the default menu and decide on the window 'close' event.** The default Close Window item would emit a close event the window could preventDefault — but the event cannot distinguish the menu accelerator from the traffic lights or the window button, so every close would need source-sniffing logic and the page's claim would not participate. Removing the item makes the menu structurally incapable of closing the window, which is the guard semantics A needs.

**Hand-written menu items.** Restating Electron's default template without Close Window keeps full editorial control, but its labels are localization-owned; role menus ship Electron's localized labels and accelerators for free.

**Keep the default menu off macOS only.** The same program-level invariant (never close from a menu accelerator) applies and costs the same on every platform; platform-splitting would multiply the test surface for no benefit.

## Consequences

The menu cannot close the window on any platform: no Close Window item and no Cmd+W / Ctrl+W accelerator anywhere in the template, on macOS or on Windows/Linux. Cmd+Q is the menu's quit path (macOS App menu; File > Quit on Windows/Linux), and the traffic lights / window button still close the window as before — that path was never intercepted and remains the way to end the app without Cmd+Q. Edit roles keep cut / copy / paste for terminal and editor fields. The renderer shortcut bridge note needed no correction (it never mentioned the menu), and the apps/electron README now documents the confirmation dialog as reachable only through the unclaimed router path, with the dsh-better-sidebar consumer claiming per semantics A.