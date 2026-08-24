# @deepseek-ai/dsh-client-ui-toolview-file-mutation

English | [中文](README.zh.md)

Keyed file-mutation toolview plugin: owns how `edit` and `write` Tool calls render inside the web conversation. The row composes the shared ToolRow chrome from the ui-tool-kit and feeds it the applied diff as the collapsed-by-default card body; the collapsed summary is the target path (a host-open link) trailed at the row's right edge by the call's total `+A -R` line counts. An errored mutation has no diff, so the model-facing error text surfaces through ToolRow's Output section with its first line as the collapsed summary.

This presentation used to live inside the `ui-tool` core; the plugin is the extraction that lets any deployment mount or drop the enhanced rows without touching the core, and lets other users install the feature into their own dsh web.

## Install

The web-app bundle mounts the plugin by default (roster row `ui-toolview-file-mutation`). To turn the enhanced rows off, remove that row from the bundle's `cordis.patch.yml` (or your own patch overlay) — unclaimed `edit`/`write` keys fall back to the generic Tool card. A standalone install into a profile:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-client-ui-toolview-file-mutation
```

The plugin registers both `edit` and `write` keys of the keyed `tool.call.toolview` slot ui-tool declares, with the conversation locale seat. It value-imports the row chrome from `@deepseek-ai/dsh-client-ui-tool-kit/client` through a declared module-table request.

## Model Experience

None, as this package renders already logged Tool calls and results without altering model requests, Tool execution, or session events.

#### KV Cache effect

None. The package is client-only presentation.

## Known Limitations and Deferred Work

- **Only `edit` and `write` keys** — other tool calls with diff-like payloads render through the generic Tool card; a new key (or a standalone `patch` intent) needs its own registration here.
- **No diff on error** — an errored mutation has no diff to show, and the surface does not persist one; the model-facing error text is the row's only evidence of intent.
