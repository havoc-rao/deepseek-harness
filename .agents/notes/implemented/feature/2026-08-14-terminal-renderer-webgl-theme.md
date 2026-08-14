# Terminal renderer: WebGL acceleration, GPU recovery, and theme linkage

## Context

Module 06 of the terminal integration track. The previous module shipped a
minimal xterm loop (FitAddon + socket wiring + flow control). This module
upgrades the renderer from the default DOM renderer to WebGL (hardware-
accelerated), adds bounded GPU context-loss recovery, links the terminal
palette to the design-system theme tokens, and completes the terminal CSS
(thin scrollbar, system font stack).

## Decision

### WebGL with bounded recovery budget

The renderer starts on `WebglAddon` (hardware-accelerated text rendering).
GPU context loss can recur under VRAM pressure; an unbounded retry loop would
burn CPU. A `WEBGL_RECOVERY_BUDGET = 3` counter rebuilds the WebglAddon on
each `onContextLoss` up to 3 times; the 4th loss falls back to `CanvasAddon`
(software-accelerated, no GPU dependency). If WebGL is unavailable at all
(headless, no GPU), the initial `loadAddon` throws and the view immediately
falls back to Canvas.

The renderer addon lifecycle lives in a dedicated `useEffect` keyed on
`[terminal]`, separate from the mount effect that creates the xterm instance.
This keeps the renderer setup/teardown independent of the pty wiring.

### Anti-flicker: `_renderRows` after resize

After `FitAddon.fit()` changes the terminal geometry, the WebGL/Canvas
renderer may hold a stale frame for one paint cycle. The 5.5.x private API
`_core._renderService._renderRows(0, rows - 1)` bypasses the render debouncer
and forces an immediate full repaint. This is version-sensitive: the method
name and path are internal to xterm 5.5.x and may change on upgrade.

The `forceRender` helper in `TerminalView.tsx` and the inline call in
`useTerminalLayout.ts` both access `_core._renderService` via optional
chaining, so a future xterm version that removes the private API degrades
gracefully (no render force, but no crash).

### Theme linkage via inject face `hooks` compartment

The terminal needs the resolved theme snapshot reactively in a React
component, but `ctx.theme` is a cordis service not directly accessible from
React. The approach mirrors `ui-deliverables`' `hostDescription` pattern:

1. `theme-source.ts` creates a `HostObservable<ThemeSnapshot>` from
   `ctx.theme.getTheme()` (snapshot) + `ctx.on('theme/change')` (subscribe).
2. The plugin body passes it through the `shell.overlay` registration's
   `inject: () => ({ hooks: { theme: themeSource } })` compartment.
3. The slot renderer synthesizes a `useTheme` selector hook on `TerminalPane`.
4. `TerminalPane` selects `snapshot.revision` (a monotonic counter) and passes
   it as `themeRevision` to `TerminalView`.
5. `TerminalView`'s `useLayoutEffect` (runs before paint) reads the resolved
   CSS variables from `document.body` computed styles and writes
   `term.options.theme`, then calls `forceRender`.

**No white flash**: `useLayoutEffect` runs synchronously after the DOM commit
but before the browser paints. The `ThemePresenter` (ui-layout) writes the
alias tokens to `body` synchronously in its `theme/change` listener — and
ui-layout is a load-order prerequisite of ui-terminal — so the DOM is already
updated when the terminal reads computed styles. The xterm canvas adopts the
new palette in the same frame the page switches.

### Color mapping: CSS variables, not hardcoded values

`terminal-theme.ts` reads computed CSS custom properties from
`document.body`:

- **Theme-dependent** (alias tokens): `background` ← `--dsw-alias-bg-base`,
  `foreground`/`cursor` ← `--dsw-alias-label-primary`, `selectionBackground`
  ← `--dsw-alias-interactive-bg-hover`.
- **Theme-invariant** (static tokens): ANSI 16-color palette ←
  `--dsw-static-red-500`, `--dsw-static-green-500`, etc. Both light and dark
  base palettes define identical `--dsw-static-*` values, so the ANSI colors
  are stable across theme switches — only the alias layer follows the active
  scheme.

This avoids hardcoded color drift: the terminal palette tracks the design
system automatically. A `FALLBACK_THEME` (dark defaults) covers the case where
the stylesheet is not loaded (e.g., jsdom tests).

### System font stack, no woff2

`fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New",
monospace'` — system fonts only, no imported woff2. No FOUT (flash of
unstyled text) because the fonts are available at first paint.

## Files

- `src/client/TerminalView.tsx` — WebGL effect with recovery budget, theme
  `useLayoutEffect`, `forceRender` helper, system font stack.
- `src/client/terminal-theme.ts` (new) — CSS variable → xterm `ITheme` mapping.
- `src/client/theme-source.ts` (new) — `HostObservable<ThemeSnapshot>` adapter.
- `src/client/index.ts` — inject `theme`, pass theme source via inject hooks.
- `src/client/TerminalPane.tsx` — `TerminalPaneInjected` with `useTheme` hook.
- `src/client/useTerminalLayout.ts` — `_renderRows` after fit.
- `src/client/terminal.module.css` — thin scrollbar, dark aesthetic.
- `package.json` / `tsconfig.json` — add `ui-theme` dependency.
- `tests/terminal-view.client.spec.tsx` — WebGL recovery, Canvas fallback,
  theme re-projection, status phases, cleanup tests.

## Testing

19 tests in `terminal-view.client.spec.tsx` (up from 8): WebGL initial load,
context-loss recovery (3 rebuilds → Canvas fallback), WebGL activation
failure → Canvas, theme revision re-projection, terminal-theme token reading,
exit/error/reconnecting/connected status phases, rapid-wheel rAF cancellation,
cleanup on unmount, resize debounce dedup, and pending-timer cleanup.

All changed source files (`terminal-theme.ts`, `TerminalView.tsx`,
`useTerminalLayout.ts`) achieve 100% coverage.
