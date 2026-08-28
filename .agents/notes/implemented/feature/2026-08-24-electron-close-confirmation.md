# Agent Note: Electron desktop Cmd+W close confirmation

Status: implemented

English | [中文](2026-08-24-electron-close-confirmation.zh.md)

## Problem

The desktop app (`apps/electron`) closes the window and disposes the host on `Cmd+W` — macOS's conventional close shortcut — with no confirmation. A mispress therefore ends the running agent session, and the default menu's Close item (Cmd+W on macOS) closes directly. The host keeps no draft of its own, but the session state it runs is exactly what a stray keystroke should not discard.

## Decision

`apps/electron/src/window.ts` intercepts the `Cmd+W` keydown on the `before-input-event` hook, prevents it from reaching the renderer or the default menu's Close accelerator, and routes it through the [main-process shortcut router](../architecture/2026-08-28-electron-main-process-shortcut-router.md). An unclaimed press shows a native question dialog modal to the window (buttons Close/Cancel, default and cancel id on Cancel). Only a confirmed Close calls `win.close()`; the existing `closed` → `window-all-closed` → `before-quit` → `host.dispose()` lifecycle then runs unchanged. A `confirmingClose` guard drops repeated keystrokes while the dialog is open, and a `showMessageBox` rejection (the parent window is already gone) is swallowed with that reason named.

Deliberate scope: only `Cmd+W` is intercepted, exactly the requested shortcut. The window close button and Windows/Linux `Ctrl+W` (the default menu's Close accelerator there) still close without confirmation, and the dialog copy is plain English with no i18n wiring.

## Alternatives considered

**Intercept the window `close` event.** Rejected: that would confirm every close path (button, menu, quit), which the request did not ask for and which makes routine quits noisy; it also adds a second prompt path to the `before-quit` disposal handshake.

**Bind a custom Close menu accelerator and confirm in its handler.** Rejected: the app ships no custom menu and the default menu already binds Close (Cmd+W on macOS); `before-input-event` interception covers the requested shortcut without touching menu wiring.

**Localize the dialog copy.** Rejected for now: the strings are two lines in one main-process module, and the renderer's locale machinery is unreachable from a native dialog, so wiring i18n would be its own project.

## Consequences

A mispressed `Cmd+W` no longer silently ends the session: the user gets one native confirm prompt whose default is Cancel — unless a registered router handler claims the press. Everything else about close behavior is unchanged, and non-Cmd+W close paths skip the confirmation by design. The router semantics (claim order, disposers, unclaimed fallback) are pinned by `apps/electron/tests`; the dialog path itself remains verified by the package build.
