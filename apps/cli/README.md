# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh web` | Launch the web GUI detached (pid and log under `$DSH_HOME`); `dsh web stop` stops it. `dsh web --dev` boots it in the foreground instead. |
| `dsh electron` | Launch the in-repo Electron desktop app (an app shell over the shared `web` profile); `dsh electron stop` stops it, `dsh electron restart` dispatches a detached restart (works from any pid-file state), `dsh electron log` tails its log. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |
| `dsh plugin --profile <name> list` | Print the profile's composed rows with their entry ids and states. |
| `dsh plugin --profile <name> enable\|disable <row>` | Toggle one loader row's `disabled` flag in the profile's `cordis.patch.yml`. |
| `dsh update --profile <name> [--install] [pkg...]` | Rebuild a profile's `link:`-installed plugins in place by running each plugin's own build script. |

The invoking directory is the default workspace root. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## Web GUI

```sh
dsh web                          # launch detached: pid + log under $DSH_HOME (http://127.0.0.1:3080 by default)
dsh web --port 8080              # forwards app flags to the relaunched server
dsh web stop                     # SIGTERM the running server (escalates to SIGKILL after a grace period)
dsh web --dev                    # foreground boot: the pre-launcher in-process profile boot, Ctrl+C disposes the tree
```

The bare command relaunches `dsh --profile web` detached (the same launcher the current process runs under, so source-launch and built-bin boots stay consistent), records the pid in `$DSH_HOME/web.pid` and appends output to `$DSH_HOME/web.log`, then waits for the server's readiness line (up to 15s) and prints the URL — the shell stays usable while the server runs:

```sh
$ dsh web --port 0
dsh: web started (pid 10289); log: /Users/havoc420/.dsh/web.log
dsh web: http://127.0.0.1:64339
```

`web stop` reads the pid and runs the shared SIGTERM-then-SIGKILL protocol. `--dev` is the launcher's own foreground switch, stripped from the forwarded app arguments; flags after it (or after any unknown token) belong to the web app, which prints its own `--help`.

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

## Toggling a plugin

`dsh plugin list` prints every row of the profile's composed tree with its entry id and state, so you can see what a row is called before toggling it:

```sh
dsh plugin --profile web list
```

`dsh plugin disable` and `dsh plugin enable` turn one loader row on or off by editing the row's `disabled` flag in the profile's `cordis.patch.yml` — the same file the boot composes and long-lived surfaces (web, Electron) hot-reload, so a toggle takes effect on a running app without a restart:

```sh
dsh plugin --profile web disable dsh-better-sidebar   # writes disabled: true for that row
dsh plugin --profile web enable dsh-better-sidebar    # removes the override again
```

The row is named by its entry id in the composed tree — or by its `name` when no row carries that id: a bundle inserting `name: dsh-better-sidebar` under `id: better-sidebar` accepts either, and the patch is written under the row's real id (a stale entry a pre-resolution literal wrote is cleaned up). `dsh plugin --profile web list` shows every id. `disable` writes `disabled: true` (creating the patch entry when absent, and replacing a `!!js` expression with a literal `true` when one gated the row). `enable` removes the override — restoring the row's declared default — and drops the entry entirely when it becomes id-only. Both are idempotent, and both preserve the file's hand-written comments and other `!!js` expressions.

A lower layer's `disabled: true` (a bundle or the home-level `$DSH_HOME/cordis.patch.yml`) still applies after an `enable`, since the toggle only edits the profile's own layer; the command warns when the composed row stays off and "force on" then needs a hand-written `disabled: false`. A typo'd id reports that no composed row carries it.

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
