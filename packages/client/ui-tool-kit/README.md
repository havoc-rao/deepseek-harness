# @deepseek-ai/dsh-client-ui-tool-kit

English | [中文](README.zh.md)

Shared Tool-row presentation library. The keyed `tool.call.toolview` rows that ship with the product (ui-tool's built-ins) and the rows contributed by standalone plugins (ui-toolview-file-mutation) all compose the same chrome: `ToolRow` (one-line summary row, whole-row disclosure, running sweep, path links, Inspect pill) fed by the pure row/card models over the frozen call/result slice — `toolRowModel`, `diffCardModel`, `readCardModel`, `searchCardModel`, `terminalCardModel`, and `webCardModel`. Keeping the chrome in one library (instead of inside the ui-tool plugin package) is what makes a third-party toolview plugin possible at all: plugin packages export no values beyond cordis loading, while this package's `/client` entry is a public module-table library.

## Consuming the kit

A keyed toolview plugin imports values from the `/client` entry and declares the module request:

```ts ignore-check
import { ToolRow, toolRowModel, diffCardModel } from '@deepseek-ai/dsh-client-ui-tool-kit/client'
```

The manifest must request the row as a module-table external (the kit is a dynamic row, not a shell-seeded static library, because its models import `abbreviateHomePath`/`resolveWorkspacePath` from the runtime client half):

```json
{
  "dsh": { "client": { "external": ["@deepseek-ai/dsh-client-ui-tool-kit/client"] } }
}
```

plus `@deepseek-ai/dsh-client-ui-tool-kit` in `peerDependencies` and `devDependencies` (`packages/client/AGENTS.md` dependency rules). The models and `ToolRow` are pure functions of their props; nothing here reads session services.

## Row contracts

`ToolRow` renders one collapsed line: leading 16px slot (state dot on error/interrupted, tool icon otherwise), title, separator, FILL-truncated summary — optionally trailed by a non-shrinking `summarySuffix` (a todo row's parallel-active count, a file-mutation row's `+A -R` totals). Any body, output, or card material makes the row expandable; the expanded body max-height-scrolls. Card kinds are mutually exclusive per call (a call declares at most one render intent). File-path summaries render as host-open links when `filePath` + `onOpenFile` are supplied; an error row's collapsed summary is the failure's first line instead.

Each card model narrows the wire `callView`/`resultView` to the primitive's props and returns `null` for every non-matching or malformed payload, routing the call to the generic path instead of crashing the row or the details panel. The `CHAT_*_MAX_LINES` constants cap a card in the chat flow (the details panel keeps the primitive's full-height default).

## Model Experience

None, as this package renders already logged Tool calls and results without altering model requests, Tool execution, or session events.

#### KV Cache effect

None. The package is client-only presentation.

## Known Limitations and Deferred Work

- **Snapshot-only rows** — each row renders the frozen `callView`/`resultView` slice; it does not refetch or reconcile later host state (the running sweep is the one live signal, and it comes from the row's own status stream, not the wire view).
- **Fixed chat caps** — the `CHAT_*_MAX_LINES` constants bound a card in the chat flow; they are compile-time constants, not deployment-configurable.
- **Kind-specific cards only** — a call renders one card kind at most; payloads that match no kind (or are malformed) route to the generic path without an error card, so a new render intent requires a new model in this package.
