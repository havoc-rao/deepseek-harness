# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |
| `dsh update --profile <name> [--install] [pkg...]` | Rebuild a profile's `link:`-installed plugins in place by running each plugin's own build script. |

The invoking directory is the default workspace root. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## Updating linked plugins

`dsh update` rebuilds a profile's out-of-tree plugins where the profile depends on them via `link:`/`file:` (pnpm links a live checkout, so refreshing the profile means rebuilding that checkout's artifacts, not reinstalling anything). It runs each plugin's own `build` script — falling back to `prepare` when a package ships no build step — in its checkout directory:

```sh
dsh update                                  # list every linked plugin across all profiles and pick
dsh update --profile web                    # rebuild every linked plugin in that profile
dsh update --profile web dsh-better-sidebar # rebuild just that plugin
dsh update --profile web --install          # pnpm install first (after dependency changes)
```

Without `--profile`, `dsh update` scans `$DSH_HOME/profiles`, prints each linked plugin (numbered) with its git state — `main ↓2 ↑1 ✖` means 2 unpulled commits, 1 local commit ahead, and dirty files — and prompts you to pick which to rebuild (empty selection rebuilds all, `q` quits). Each listed git checkout is fetched read-only first so the state is current. Non-interactive use (no TTY) prints the list and asks for an explicit `--profile`.

- `--pull` runs `git pull --ff-only` in each selected checkout before building: a fast-forward-only update that refuses to merge local commits or a dirty tree, surfacing them as an error instead. Combined with `--install` it is the full sync: remote code, dependencies, and rebuilt artifacts.
- Plugins installed from a registry (a version spec), or checkouts without a `.git`, have no remote to fetch or pull and are treated as local-only: skipped by `--pull`, still rebuilt.

Restart `dsh web` after an update: config patches hot-reload, bundled module artifacts do not.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../packages/boot/cmdline/README.md)). Launcher flags therefore come first, and the first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer).

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Development

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
