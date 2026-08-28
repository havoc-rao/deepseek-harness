# Agent Note: Paper-tone axis in the Web appearance settings

Status: implemented

English | [中文](2026-08-28-web-paper-tone-axis.zh.md)

## Problem

The Web GUI's appearance settings offered a single light/dark/system axis. Reading surfaces (app background, sidebar, chat bubble, inputs, code blocks) could only be neutral white or neutral dark; users who want a warm or tinted "paper" (cream, sepia, eye-care green) had no product surface for it, and the preference machinery was wired so that the OS color scheme always decided the tint.

## Decision

The appearance settings gained a second, independent axis: the paper tone (`ui-theme.paper`, values `default`/`cream`/`sepia`/`green`). The tone is product-fixed surface recolor data in the `@deepseek-ai/dsh-client-ui-paper` feature plugin's `src/paper-tones.ts` — fifteen alias tokens per tone, each carrying mandatory `{ light, dark }` variants — and lives on the same durable `ui-theme` settings namespace as `preference`, with a schema default of `default` so existing documents remain valid. The vocabulary (`PaperTone`, `PAPER_TONES`, `DEFAULT_PAPER`) stays with the schema in the theme package; the plugin builds its table and UI against it via type-only imports.

ThemeRuntime owns the axis alongside the preference: `setPaper` writes through the settings scope, `ThemeSnapshot` carries `paper`, and `composeActive` folds the tone's layer last — after third-party `overrideTokens` layers — so the product tone beats dynamic layers. The layer table is contributed at apply by the ui-paper plugin through `registerPaperToneLayers` (the service's consumer seam, with a disposer so an HMR collapse restores the inert state); without a contribution the field persists but tints nothing. The presenter needs no awareness: the folded tokens arrive inside `active.tokens`, and `active.colorScheme` still drives `body[data-ds-dark-theme]`. The system color scheme therefore never selects a tone: it only picks which of the tone's two palette variants applies, so a sepia paper stays sepia when the OS flips schemes.

The ui-paper host half contributes its own bootstrap row after the theme row: it embeds the durable tone and preference from the theme settings namespace and writes the tone's per-scheme variants as inline body variables before the shell mounts, so the first paint is already tinted; the [pre-plugin theme bootstrap](../bug-fix/2026-08-10-pre-plugin-theme-bootstrap.md) owns that mechanism and this row mirrors its dark resolution. The browser settings scope validates but does not apply schema defaults, so a document written before the paper field existed arrives without the key; `adopt` resolves the default in the owning implementation instead of the scope (wire JSON boundary).

The plugin registers its own General-section settings row (`paper-tone`, order 11) under the appearance row: an entry showing the current tone, expanding in place to a selection panel with one paper-identity swatch per tone. The v1 surface set covers the reading surfaces only; static-token consumers and tokens outside the list keep the base palette.

## Alternatives considered

**Paper tones as registered themes.** Choosing sepia would replace the active light/dark theme, losing `system`-following; the requirement was explicitly that the tone survive the system axis. The override-layer machinery exists precisely to stack a hue family over any base scheme.

**A separate settings namespace.** The write serialization, revision ordering, and rejection reload machinery is per-namespace; a second namespace would split the appearance document into two revision streams for no persistence benefit. Both fields share `ui-theme`.

**Browser-local tone without Host persistence.** The theme package's durable path is the product contract; a process-local tone would reset on reload and diverge from the boot embed.

**Apply the schema default in the settings scope.** The scope validates wire values and returns them raw; changing its behavior would affect every registered namespace. Defaulting at `adopt` keeps the wire contract untouched.

## Consequences

The ui-paper plugin's settings row shows the paper-tone entry — the current tone label, expanding in place to a selection panel with one paper-identity swatch per tone (the layer's light `--dsw-alias-bg-base`, data-driven from the plugin's table; `default` falls back to the neutral paper white). The tone persists through reload, remote-browser adoption, and OS scheme flips, and the first paint is tinted without a flash. The composed snapshot and the inspect token directory include the tone's tokens, so third-party observers see the folded values. The cost: a fixed v1 token list that needs a token-design task to extend, and paper coverage that intentionally skips static-token consumers; without the plugin the durable field is inert.

## Testing

ThemeRuntime specs pin `setPaper` writes, contributed-layer folding per scheme, tone-over-`overrideTokens` precedence, paper-only adoption, and the wire default for older documents; the ui-paper apply spec pins the layer contribution and its HMR-disposer, the row registration, the store mirror, and the write route; the row spec pins the entry's collapsed state, expansion, swatch colors, selection, and click surface; the bootstrap spec pins the embedded variants; the host spec pins schema defaults and the embedded tone. The ui-layout presenter specs run unchanged — the presenter never learns about the axis.
