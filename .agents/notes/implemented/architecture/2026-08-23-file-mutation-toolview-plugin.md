# Agent Note: The file-mutation toolview ships as a plugin over a shared row kit

Status: implemented

English | [中文](2026-08-23-file-mutation-toolview-plugin.zh.md)

## Problem

The keyed `edit`/`write` tool rows (applied diff card plus the trailing `+A -R` totals suffix) lived inside `ui-tool`'s browser plugin, mounted unconditionally by `apply.ts`. That fused a deployable presentation choice into the core package: any deployment that wanted the rows had them, any that did not could not drop them without editing core, and the rows were not installable into another dsh web. The blocker to moving them out was the client dependency rules: plugin packages export no values beyond cordis loading, and cross-package value imports of another plugin's symbols are forbidden — yet the row composes `ToolRow` and the pure row/card models (`toolRowModel`, `diffCardModel`, …), which were ui-tool internals also used by the generic fallback and the details panel.

## Decision

The row chrome is now a public presentation library, and the file-mutation rows are a standalone plugin:

- **`@deepseek-ai/dsh-client-ui-tool-kit`** (`packages/client/ui-tool-kit`): `ToolRow` plus the six row/card models and their CSS, moved out of ui-tool. Its `/client` entry is the module-table value consumers import — the sanctioned library route. It is a dynamic row (not a shell-seeded static library) because the models import `abbreviateHomePath`/`resolveWorkspacePath` from the runtime client half; consumers request it through `dsh.client.external` (its first real use) plus peer/dev npm sections. `ui-tool` consumes it for the generic fallback, `ToolDetails`, and its built-in rows.
- **`@deepseek-ai/dsh-client-ui-toolview-file-mutation`** (`packages/client/ui-toolview-file-mutation`): the `edit`/`write` rows with the diff card and the `+A -R` suffix, registered through `ctx.slots.inject('tool.call.toolview', …)` exactly as before. The web-app bundle mounts it by default (roster row `ui-toolview-file-mutation`); removing the row turns the enhanced presentation off and `edit`/`write` fall back to the generic card. Standalone installs use `dsh plugin --profile web add @deepseek-ai/dsh-client-ui-toolview-file-mutation`.
- **Core capabilities stay in core**: `diffLineCounts` remains in `ui-primitives` (any consumer may derive change magnitude with one line-terminator rule), and `ToolRow.summarySuffix` remains a generic chrome slot accepting a `ReactNode` (the todo row uses it as a string).

The kit and plugin are two package-checklist additions: `tsconfig.client.json`/`tsconfig.base.json` entries, bundle rows, `web-app` dependencies, and the kit `/client` module request.

## Alternatives considered

### Export `ToolRow` and the models from `ui-tool`'s `/client` entry

The smallest change: ui-tool value-exports the chrome, the plugin imports it. Rejected — it violates the client export discipline (a new value export needs sign-off and a matching consumer) and the "no cross-package value imports" rule, and it couples every third-party toolview to ui-tool's internals, which upstream may never merge. The kit makes the chrome a stable public contract instead.

### A self-contained row in the plugin, duplicating the chrome

The plugin renders its own row from `ToolCallViewProps` only (the `ui-skill` `SkillRow` pattern), with no shared library. Rejected — the file-mutation row is a small delta (the suffix) over the full `ToolRow` interaction surface (whole-row disclosure, running sweep, path links, Inspect pill, IN/OUT labels); duplicating ~400 lines of chrome diverges from the unified interaction every other card row has and hand-rolls maintained presentation.

## Consequences

- ui-tool no longer registers `edit`/`write`; the file-mutation presentation is an independently versioned, disableable, installable plugin, and the `+A -R` suffix feature the fork added is usable by other deployments without core changes.
- The kit is the first real `dsh.client.external` request; the module-graph gates (`verify-client-packages`, bundle purity) validate the supplier and cycle rules, so a third package reusing the kit follows the same one-line manifest pattern.
- The kit's tests moved with the code: model derivations and `ToolRow` chrome are pinned in the kit's specs, the plugin's row/registration in its own spec, and ui-tool keeps the fallback and details-panel coverage. The moved files keep git history (`git mv`).

## Testing

The affected suites (ui-tool, ui-tool-kit, ui-toolview-file-mutation) pass under `pnpm run test:gui`; the keyed-slot acceptance chains that mount real plugin compositions pass once stale build artifacts are cleaned from the source tree (`pnpm run clean`), because a stale `.js` emit next to a `.ts` source shadows it under vite's extension order.
