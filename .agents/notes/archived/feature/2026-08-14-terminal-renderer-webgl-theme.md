# Agent Note: Terminal renderer — WebGL acceleration, GPU recovery, and theme linkage

Status: implemented
Archived: 2026-08-23

English | [中文](2026-08-14-terminal-renderer-webgl-theme.zh.md)

## Problem

The browser-interactive terminal pane shipped with xterm's default DOM renderer, which is CPU-bound and flickers under large output. The pane also needs to follow the design-system theme (light/dark) without a white flash, and the system font stack must not cause a FOUT. These are rendering-layer concerns on top of the PTY socket bridge — they do not change the frame protocol or the host bridge.

## Decision

### WebGL with bounded recovery budget

The renderer starts on `WebglAddon` (hardware-accelerated). GPU context loss can recur under VRAM pressure; an unbounded retry loop would burn CPU. A `WEBGL_RECOVERY_BUDGET = 3` counter rebuilds the WebglAddon on each `onContextLoss` up to 3 times; the 4th loss falls back to `CanvasAddon`. If WebGL is unavailable at all (headless, no GPU), the initial `loadAddon` throws and the view immediately falls back to Canvas.

The renderer addon lifecycle lives in the same `useEffect` that creates the xterm instance, not a separate `[terminal]` effect, so teardown can dispose the renderer before `Terminal.dispose` runs the AddonManager a second time — a still-active WebGL addon crashes mid-teardown (reads `_isDisposed` on a half-released renderer).

### Anti-flicker: `_renderRows` after resize

After `FitAddon.fit()` changes the terminal geometry, the WebGL/Canvas renderer may hold a stale frame for one paint cycle. The 5.5.x private API `_core._renderService._renderRows(0, rows - 1)` bypasses the render debouncer and forces an immediate full repaint. The `forceRender` helper in `TerminalView.tsx` and the inline call in `useTerminalLayout.ts` both access `_core._renderService` via optional chaining, so a future xterm version that removes the private API degrades gracefully (no render force, but no crash). The method name and path are internal to xterm 5.5.x; upgrading xterm requires regressing this module and patching the tests.

### WebglAddon dispose shim

addon-webgl 0.19.0's dispose cleanup reads `_core._store._isDisposed` (an xterm 6 private field) and throws on the missing field — unmounting a WebGL terminal crashes the `shell.overlay` slot entry and hides the toggle button. `patchWebglDisposeShim` plants a disposed sentinel (`_store = { _isDisposed: true, dispose() {} }`) when the field is absent, making the cleanup short-circuit. On xterm 6 the field already exists and is left untouched.

### Theme linkage via inject face `hooks` compartment

The terminal needs the resolved theme snapshot reactively in a React component, but `ctx.theme` is a cordis service not directly accessible from React. The approach mirrors the `hostDescription` pattern: `theme-source.ts` creates a `HostObservable<ThemeSnapshot>` from `ctx.theme.getTheme()` (snapshot) + `ctx.on('theme/change')` (subscribe); the plugin body passes it through the `shell.overlay` registration's `inject: () => ({ hooks: { theme: themeSource } })` compartment; the slot renderer synthesizes a `useTheme` selector hook on `TerminalPane`; `TerminalPane` selects `snapshot.revision` (a monotonic counter) and passes it as `themeRevision` to `TerminalView`; `TerminalView`'s `useLayoutEffect` (runs before paint) reads the resolved CSS variables from `document.body` computed styles and writes `term.options.theme`, then calls `forceRender`.

No white flash: `useLayoutEffect` runs synchronously after the DOM commit but before the browser paints. The `ThemePresenter` (ui-layout) writes the alias tokens to `body` synchronously in its `theme/change` listener — and ui-layout is a load-order prerequisite of ui-terminal — so the DOM is already updated when the terminal reads computed styles. The xterm canvas adopts the new palette in the same frame the page switches.

### Color mapping: CSS variables, not hardcoded values

`terminal-theme.ts` reads computed CSS custom properties from `document.body`: theme-dependent alias tokens (`background` ← `--dsw-alias-bg-base`, `foreground`/`cursor` ← `--dsw-alias-label-primary`, `selectionBackground` ← `--dsw-interactive-bg-hover`) and theme-invariant static tokens (ANSI 16-color palette ← `--dsw-static-*`). Both light and dark base palettes define identical `--dsw-static-*` values, so the ANSI colors are stable across theme switches — only the alias layer follows the active scheme. A `FALLBACK_THEME` (dark defaults) covers the case where the stylesheet is not loaded (jsdom tests).

### System font stack, no woff2

`fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace'` — system fonts only, no imported woff2. No FOUT because the fonts are available at first paint.

## Alternatives considered

**Keep the DOM renderer.** Rejected: the DOM renderer is CPU-bound and reflows the entire viewport on every output line; large `ls` or `cat` output causes visible jank. WebGL offloads text rasterization to the GPU and is the xterm-recommended renderer for interactive use.

**Unlimited WebGL recovery.** Rejected: GPU context loss can recur under sustained VRAM pressure, and an unbounded retry loop burns CPU on a terminal the user may have backgrounded. A budget of 3 keeps the terminal usable without an infinite reload loop.

**Hardcode the xterm theme palette.** Rejected: hardcoded color values drift from the design system when the palette changes. Reading computed CSS variables keeps the terminal in sync automatically.

**Import a bundled woff2 font.** Rejected: a web font causes a FOUT (flash of unstyled text) on first paint. The system monospace stack is available immediately and avoids an external asset dependency.

## Consequences

- The terminal renderer is hardware-accelerated under normal conditions and degrades gracefully to Canvas on GPU loss or unavailability.
- The xterm 5.5.x private API dependencies (`_renderRows`, `_store`, `scrollToBottom`) make xterm or addon-webgl upgrades deliberate regression points, not drop-ins.
- The terminal palette tracks the design system automatically; a theme switch re-projects colors with no white flash.
- The WebglAddon dispose shim is temporary and must be removed when xterm and addon-webgl are version-aligned.
