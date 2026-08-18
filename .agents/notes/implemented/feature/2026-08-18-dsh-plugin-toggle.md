# Agent Note: `dsh plugin enable|disable` entry toggle

Status: implemented

English | [中文](2026-08-18-dsh-plugin-toggle.zh.md)

## Problem

A profile's plugin tree composes from patch layers, and a row's `disabled` flag is the switch that turns a plugin off or on. Before this change the only ways to flip that switch were hand-editing `$DSH_HOME/profiles/<name>/cordis.patch.yml` (or the home-level patch) and trusting the hot-reload, or uninstalling the plugin entirely through `dsh plugin --profile <name> remove <package>` — which destroys the profile's bundle dependency instead of toggling a row. `dsh plugin` had no verb for start/stop, only for install/uninstall, so a user asking "how do I turn this plugin off" had no command-line answer.

## Decision

**Add `dsh plugin --profile <name> enable|disable|list`** as intercepted verbs on the existing `dsh plugin` command in `apps/cli` (`src/plugin-entries.ts`):

- `list` prints every row of the profile's composed tree with its entry id and effective state (`enabled`, `disabled`, or `expression` for a `!!js` gate); it is read-only and fails loud when the tree cannot be composed.
- `disable <row>` writes `disabled: true` for the row's entry id into the profile's own `cordis.patch.yml`, creating the patch entry when absent and replacing any prior value (including a `!!js` expression) with a literal `true`.
- `enable <row>` removes the row's `disabled` override, restoring the row's declared default instead of forcing it on; an entry left with only its `id` key is dropped entirely, so disable→enable cycles leave no residue in the file.
- A row is named by its entry id; when no composed row carries it, the name is resolved by `name` (a bundle inserting `name: dsh-better-sidebar` under `id: better-sidebar` accepts either spelling), and an earlier literal-id toggle's bare entry is dropped when the same invocation resolves it to a different id. A profile whose tree cannot be composed falls back to the literal id — disabling a row is exactly what a user does to a broken tree.
- Both toggle verbs are idempotent, and every edit is applied as a `yaml` v2 AST (a new direct dependency of `@deepseek-ai/dsh`) rather than re-serializing parsed objects: hand-written comments, formatting, and unrelated `!!js` expression nodes survive. The `yaml` package was chosen over the already-present `js-yaml` because the include schema's `js-yaml` round-trip drops comments and reformats the whole file, which would rewrite a user's hand-edited layer on every toggle.
- After the edit the command re-derives the composed tree (bundle layers + profile layer + home layer, through `loadProfile`/`composeEntries`, boot-free and best-effort) and warns when the row is still disabled by a lower layer after `enable`, or when the row matches no composed row. Composing must never block a toggle.
- The toggle lands in the profile patch layer, which long-lived surfaces (web, Electron) hot-reload via `watchUserPatches`, so a CLI toggle reaches a running app without a restart. A missing profile is initialized first, like every `dsh plugin` verb.

The grammar change is a positional interception: the first token after `--profile` equal to `list`/`ls`, `enable`, or `disable` routes to the profile-entries runner (`list` takes no arguments; the toggles require exactly one row), while every other verb still forwards verbatim to pnpm.

## Alternatives considered

**Add dedicated `dsh plugin enable/disable` subcommands with their own `--profile` requirement.** Rejected: the existing grammar keeps `--profile` on the parent `plugin` command and rejects parent options on subcommands, so making the verbs subcommands would force `dsh plugin enable --profile <name> <id>`, breaking the established `dsh plugin --profile <name> <verb>` shape used by `add`/`remove`.

**Have `enable` write `disabled: false` to force the row on.** Rejected: the profile patch layer is one user-override stack; writing `false` steals control from lower bundle layers and leaves a permanent no-op entry after every disable→enable cycle. Removing the override expresses "restore the declared default" and keeps the file clean; forcing a lower-layer-disabled row on remains a documented one-line hand edit (`disabled: false`), which the command's warning names.

**Hand-edit raw text lines with a regex.** Rejected: matching entry boundaries, indentation, and `!!js` values is exactly the class of fragile parsing the repo's dependencies-over-hand-rolling policy rejects. A maintained `yaml` AST library already exists in the workspace.

## Testing

`apps/cli/tests/plugin-entries.spec.ts` drives `runToggle`/`runList` against a real temporary `$DSH_HOME` and asserts the written `cordis.patch.yml` byte-for-byte: entry creation and deletion, idempotency, comment/`!!js` preservation, literal-`true` replacement, lower-layer-disable warnings, typo'd-id warnings, broken-tree acceptance, name resolution to the real id, stale-literal cleanup, idless-row rejection, the list output's rows and state labels, and loud failures on a non-array or unparsable layer. `apps/cli/tests/args.spec.ts` covers the grammar routing and the malformed-invocation rejections for all three verbs.

## Related

The ordinal composition the toggle edits — profile patch layers stacked over bundles in `dsh.profile.bundles` order — is owned by the [profile plugin bundles note](../architecture/2026-08-05-profile-plugin-bundles.md).

## Consequences

The CLI now answers "turn this plugin off/on" with a two-word verb that operates on the same file the boot composes, so every future surface boots with the toggle applied and long-lived surfaces pick it up live, and `list` shows what a row is called before toggling. The trade-offs: the toggle edits only the profile's own layer (lower-layer disables keep standing after `enable` — surfaced as a warning, not silently ignored), and a row is named by entry id or row name rather than a package identity, so an unfamiliar bundle's row still needs a `list` look-up. `@deepseek-ai/dsh` gains one new runtime dependency (`yaml@^2.9.0`) for comment-preserving AST edits.