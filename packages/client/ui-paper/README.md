# @deepseek-ai/dsh-client-ui-paper

English | [中文](README.zh.md)

Paper-tone feature plugin over the ui-theme service: the Appearance settings surface gains an independent surface-color axis (`paper`, values `default`/`cream`/`sepia`/`green`) that never follows the OS color scheme. The plugin owns the visual layer table (`src/paper-tones.ts`: fifteen reading-surface alias tokens per tone, each with mandatory `{ light, dark }` variants), contributes it into `ctx.theme.registerPaperToneLayers` at apply (so the composed snapshot folds the tone's per-scheme variant last), and registers its own General-section settings row: an entry showing the current tone, expanding in place to a selection panel with one data-driven paper-identity swatch per tone. Writes go through `ctx.theme.setPaper`; the durable `paper` field, the `PaperTone` vocabulary, and the schema live in the [theme service](../ui-theme/README.md) (`ui-theme.paper`). Without this plugin the field persists but tints nothing.

The host half contributes its own bootstrap row after the theme row: it embeds the durable tone and preference from the theme settings namespace and writes the tone's per-scheme token variants as inline body variables, so the first paint is already tinted. The dark resolution mirrors the theme bootstrap script so the two rows agree regardless of listener order.

The v1 token set covers the reading surfaces (app base and layers, sidebar, chat bubble, inputs, code blocks); components that consume static tokens directly, and tokens outside the list, keep the base palette. Extending the list is a token-design task.

## Model Experience

None, as the paper tone manages a browser preference; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Paper-tone coverage is a fixed v1 surface set** — each tone recolors the reading surfaces listed in `src/paper-tones.ts`; static-token consumers and tokens outside the list keep the base palette.
- **The tone stays inert without the theme service's layer registration** — the plugin contributes the table at apply; an HMR collapse clears it and the persisted tone stops tinting until the fiber returns.