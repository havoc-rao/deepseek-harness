# Agent Note: Electron desktop window chrome (hidden title bar + web drag strip)

Status: implemented

English | [中文](2026-08-28-electron-hidden-title-bar.zh.md)

## Problem

The desktop shell (`apps/electron`) created its window with the default OS frame, so the UI showed a conventional title bar (with nothing but the page title in it) above the web client's three-column application frame. The rendered surface already starts at its own top edge, making the OS bar a dead strip that visually doubles the top border, and on macOS the traffic lights sat at Electron's default position unrelated to the sidebar's logo row.

## Decision

`apps/electron/src/window.ts` switches window chrome per platform. macOS uses `titleBarStyle: 'hiddenInset'` with an explicit `trafficLightPosition` (`{ x: 12, y: 8 }`) that pins the traffic lights into the window's own top row, hugging the top-left corner (traffic lights kept — the native close/min/zoom controls and the system double-click zoom stay available). Windows uses `titleBarStyle: 'hidden'` with `titleBarOverlay` tinted to the window background (`#0b0d10`) so the native min/max/close buttons remain over a blended strip. Linux keeps the default frame.

The renderer is the same shared web client served over loopback HTTP with no preload bridge, so the web layer detects the shell itself: the boot kernel (`packages/client/web/src/shell-chrome.ts`) parses `navigator.userAgent` (Electron appends its version) and marks `documentElement.dataset.shell` (`electron-mac` / `electron-win` / `electron-linux`) before the UI mounts. CSS keys off the mark only:

- `ui-layout` AppFrame renders a 14px top drag strip, normally inert (`pointer-events: none`), that becomes the window's top drag target (`-webkit-app-region: drag`) under the mark. 14px clears the sidebar's first interactive row (buttons start at y=14).
- `ui-sidebar` reserves a top band on macOS (`--dsh-shell-top-inset: 20px`, added to the root padding in both the wide and the rail states): the brand row stacks below the traffic lights instead of clearing them horizontally, so the column keeps its full left edge. A `::before` drag target fills the band (`-webkit-app-region: drag`), sized to the padding it replaces, and the logo row still extends the drag target with the brand and toggle marked `no-drag`, so both stay clickable.

Plain browsers (`dsh web`) never carry the mark and ignore `-webkit-app-region`, so they see no change.

The host plugin tree gets its own explicit signal: the shared 'web' profile also boots under the CLI, so a plugin cannot tell the host from the profile alone. `apps/electron/src/shell.ts` provides `ctx.desktopShell === true` before the tree mounts (alongside the shortcut router), and the renderer-side plugins read `documentElement.dataset.shell`; a plugin defines its Electron-only behavior behind either flag.

## Alternatives considered

**Frameless everywhere (`frame: false`) with custom window controls in the web UI.** Rejected: the web client would have to draw and position min/max/close, handle drag and double-click zoom itself, and every subsequent layout change would re-fight that chrome; keeping the native controls per platform is both less code and the platform-idiomatic look.

**Main-process `insertCSS` injecting the drag region.** Rejected: the UI is built from CSS Modules with hashed class names, so the main process would reach into renderer internals; the shell mark keeps the knowledge in the web layer where the layout lives.

**Preload/IPC bridge to signal the shell.** Rejected: no preload exists today, and UA sniffing is reliable for this signal (Electron always appends its version unless intentionally disabled); the mark needs zero new wiring.

## Consequences

The window's top edge is the web UI's own chrome: drag from any of the top 14px, the sidebar's reserved band, or the logo-row gaps, double-click the drag region for the macOS zoom action, and the traffic lights keep working where the system draws them. Windows keeps native window buttons over a tinted strip; Linux and plain browsers are unchanged. The page title still propagates (`page-title-updated`) for Mission Control and dock tooltips. The drag strip is deliberately thin and the sidebar band is sized to the traffic lights, so no interactive control loses hit area. Detection and marking are unit-covered in `packages/client/web/tests/shell-chrome.client.spec.ts`; window construction is verified by the electron package build.