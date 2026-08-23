# `dsh` CLI behavior reference

English | [中文](README.zh.md)

This reference defines the profile, web-alias, plugin-management, and config-dump command modes. Argv is parsed once through [`src/args.ts`](../src/args.ts), and [`src/bin.ts`](../src/bin.ts) dynamically imports only the selected runner.

## Profile boot

`dsh --profile <name>` boots the profile at `$DSH_HOME/profiles/<name>`. The effective tree is composed over an empty root by applying, in order: each bundle patch named in the profile manifest's `dsh.profile.bundles` list, the profile's own `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml` (machine-local preferences shared by every profile, so it outranks the per-profile layer), and each `--patch <path>` overlay in argv order. Later layers win per row; a patch replaces the targeted row's complete `config` value rather than deep-merging keys, and may insert new rows. A parse, schema, resolution, or plugin boot failure is reported and exits nonzero. SIGINT and SIGTERM dispose the mounted root before exit.

Bundle names resolve from the dsh installation first, then from the profile directory. In-box bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`) therefore always come from the same installation as the running `dsh`; out-of-tree bundles come from the profile's pnpm-managed `node_modules`. A bare plugin `name` in any patch row resolves through the profile directory's Node parent-walk, which reaches the maintained installation fallback `$DSH_HOME/profiles/node_modules` (one symlink per package the installation's app and bundles depend on, healed on every launch).

The `web` and `headless` profiles auto-initialize from shipped templates on first use (`web`: base + web-app; `headless`: base + headless). Any other missing profile fails loud with a hint to run `dsh plugin --profile <name> add <package>`.

### App arguments

The launcher's flags come first and end at the first token it does not recognize; everything from there on is handed to the booted profile verbatim through `ctx.cmdlineArgs`, where any injected app plugin may parse it ([`dsh-cmdline`](../../../packages/boot/cmdline/README.md)). `dsh --profile web --port 8080` therefore reaches the web app's `--port`, `dsh --profile web --help` prints that app's help and boots nothing, and `dsh --help` (no profile to hand it to) prints the launcher's own. `-V`/`--version` prints the launcher's version when it appears before the app-argument boundary.

A composition mounts once. An ordinary plugin injects `cmdlineArgs`, parses this app's arguments, and provides what it resolved as a service; each row configured from flags injects that service, and Loader waits for it before evaluating the row's config (`port: !!js ctx.webStartup.port ?? 3080`). A flag therefore beats the value written beside it. This precedence requires the row to retain that expression; a user patch that replaces the whole `config` with literals removes the runtime read. Help and rejected arguments request exit — nonzero for a rejection, 0 for help — without activating rows that depend on the provider's service. A live `cordis.patch.yml` edit re-evaluates expressions against services that are still up, so it cannot reset a served port.

Launcher flags must come before app arguments, and the launcher's parser consumes one `--`: an app argument that must arrive as a literal `--` needs `-- --`. A first app argument equal to `web` or `plugin` selects that subcommand instead. `ctx.cmdlineArgs.get()` is a shared immutable read: multiple plugins may parse the same snapshot, while a profile with no reader ignores its app arguments.

The shipped apps own these command lines:

| Profile | Arguments |
|---|---|
| `web` | `--host`, `--port`, repeatable `--trusted-host`, `--no-open` |
| `headless` | the task text, as the positional argument |

A one-shot task (`dsh --profile headless "run the tests"`) creates one fresh persisted Agent through the core registry, submits the task, waits for quiescence, and flushes the Session before deriving the last non-empty assistant text and final `turn/end` reason from its durable interval. It prints the text on stdout and exits 0 for `completed`, else 1. An invocation with no task is a usage error from that app. The shipped headless profile mounts no ApiProxy, Host, HTTP server, Web runtime, or browser client; a successful run writes nothing to stderr and opens no listening port.

Inspect the composed tree without booting it:

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` prints only the bundle layers; `--dump-config` adds the profile's `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`, and `--patch` overlays. Both print comments naming the file that supplied each row and every overlay that changed it; `!!js` expressions remain unevaluated, and unmatched patch targets are reported on stderr. A dump never runs app command-line providers, so it shows the composed tree before any app argument is resolved and rejects an invocation that carries app arguments.

## Plugin management

`dsh plugin --profile <name> <args...>` initializes the profile when missing (shipped template, or `@deepseek-ai/dsh-base` alone for other names), then forwards `<args...>` to `pnpm` with the profile directory as working directory — `add`, `remove`, `why`, `update`, and every other pnpm verb work unchanged; pnpm must be on PATH. Relative path specs (`.`, `../plugin`, and their `file:`/`link:` forms) are anchored to the invoking directory first, so `add .` from a plugin checkout installs that checkout, not the profile. After every successful run, `dsh.profile.bundles` is reconciled against the installed state: each dependency resolving to a package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` joins the layer stack (so an `update` that gains the declaration activates it), a bundle-less dependency stays plain with a one-time warning, and a removed dependency leaves the stack.

The Codex and Claude Code subagent providers are separate optional Bundles. Add either package, both in one command, or remove either package independently:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-codex @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-codex
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
```

The successful pnpm operation changes the Profile manifest and Bundle list on disk; a running Profile keeps the Bundle set from its current start. Restart that Profile after adding, removing, or updating a Bundle. This startup boundary applies to Bundle membership, while ordinary edits to the Profile or home `cordis.patch.yml` take effect through hot reload. On the next start, each installed Bundle registers only its dormant Host provider; a copied Preset must separately enable the matching tool row for new Agents. The [Codex provider README](../../../packages/subagent/subagent-codex/README.md) and [Claude Code provider README](../../../packages/subagent/subagent-claude-code/README.md) own executable, authentication, payload, and failure details; the [base Bundle reference](../../../packages/bundle/base/README.md) owns the default dependency closure.

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

Git-hosted plugins that ship sources build during install through their `prepare` script, which pnpm ≥10 blocks until the consumer allows it: the first `add` fails with pnpm's `allowBuilds` hint (and a dsh pointer at the profile's `pnpm-workspace.yaml`); copy the printed key there and re-run. Installing a built tarball or a local checkout needs no allowance.

### Enabling and disabling a row

`dsh plugin --profile <name> list` prints every row of the profile's composed tree (bundle layers, the profile's `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`) with its entry id and effective state — `enabled`, `disabled`, or `expression` when a `!!js` value gates the row. The list is read-only and fails loud when the tree cannot be composed; it is the purpose-built way to find the id `--dump-config` shows.

`dsh plugin --profile <name> disable <row>` and `enable <row>` toggle one loader row's `disabled` flag by editing the profile's own `cordis.patch.yml` — the same user layer shown to the boot and hot-reloaded on long-lived surfaces, so an edit reaches a running web/Electron app without a restart. The row is named by its entry id in the composed tree; when no row carries that id, it is looked up by `name` — a bundle inserting `name: dsh-better-sidebar` under `id: better-sidebar` accepts either spelling, the patch is written under the row's real id, and a bare entry an earlier literal-id toggle left behind is dropped instead of stacked. A profile whose tree cannot be composed falls back to the literal id. The profile is initialized when missing, like every `dsh plugin` verb.

`disable` writes `disabled: true` for the row, creating the patch entry when absent and replacing any prior value (including a `!!js` expression) with a literal `true`. `enable` removes the row's `disabled` override, restoring the row's declared default rather than forcing it on; an entry left with only its `id` key is dropped entirely, so disable→enable cycles leave no residue in the file. Both verbs are idempotent, and the edit is applied as a YAML AST — hand-written comments, formatting, and unrelated `!!js` expression nodes survive.

Because the toggle edits only the profile's layer, a `disabled: true` from a lower layer (a bundle, or the home-level `$DSH_HOME/cordis.patch.yml`) still stands after `enable`; the command composes the tree after the edit (boot-free, best-effort) and warns when the row stays off — forcing it on then requires a hand-written `disabled: false` in the profile layer. A row that no composed row carries is reported as a warning, so a typo cannot silently write a no-op patch; a profile whose tree cannot be composed (a broken bundle) still accepts the toggle, since disabling a row is exactly what a user does to a broken tree.

```sh
dsh plugin --profile web list
dsh plugin --profile web disable dsh-better-sidebar
dsh plugin --profile web enable dsh-better-sidebar
```

## Web GUI launcher

`dsh web` is a pid launcher: the bare command relaunches `dsh --profile web` detached through the same launcher the current process runs under (so a source-launch under `--import tsx` and a built-bin boot stay self-consistent), records the pid in `$DSH_HOME/web.pid`, appends the server's output to `$DSH_HOME/web.log`, waits for the web app's readiness line (up to 15s) and prints the URL to the terminal before returning. `dsh web stop` reads the pid and runs the shared SIGTERM-then-SIGKILL protocol; re-running `dsh web` while a server is live prints the running instance's URL alongside the failure message. The web app's own flags — `--host`, `--port`, repeatable `--trusted-host` — follow the command and are forwarded verbatim; `--patch` overlays reach the relaunched boot too.

```sh
dsh web                              # launch detached (pid + log under $DSH_HOME)
dsh web --patch ./extra.cordis.yml   # overlay for the relaunched server
dsh web --port 8080                  # app flags forward to the relaunched server
dsh web stop                         # SIGTERM, escalation to SIGKILL after 3s, then remove the pid file
dsh web --dev                        # foreground boot: the classic in-process profile boot, Ctrl+C disposes the tree
dsh web --dev --port 8080            # --dev is the launcher's own switch and is stripped from the app args
dsh web --help                       # the web app's own help still prints and exits in the foreground
```

`--dev` is the launcher's own foreground switch: it boots the profile in this process exactly like `--profile web` always did, so the URL line lands on the terminal and Ctrl+C disposes the tree in place. A config dump (`--dump-config`/`--dump-default-config`) stays boot-free and wins over every action.

The production Web runner needs built package and frontend artifacts (`pnpm run build`). It serves `http://127.0.0.1:3080` by default. The CLI intentionally does not support `--host 0.0.0.0` yet and exits with a usage error; `--trusted-host` adds named authorities accepted by the `/api` browser-trust fence.

## Electron desktop app

`dsh electron` manages the Electron shell over the same shared `web` profile that `dsh web` boots in-process. The launcher stays a resolver: it finds the in-repo `@deepseek-ai/dsh-electron` package (its directory beside `apps/cli` in the repository layout) and the `electron` binary its devDependencies install (the electron package's `path.txt`, so a pnpm store layout or a hoisted node_modules both resolve), records the spawned pid under `$DSH_HOME/electron.pid`, appends the app's output to `$DSH_HOME/electron.log`, and returns immediately — the shell stays usable while the window runs:

```sh
dsh electron                     # launch detached (alias of the start action)
dsh electron start --dev          # explicit start; --dev reaches the Electron main process
dsh electron stop                 # SIGTERM, escalation to SIGKILL after 3s, then remove the pid file
dsh electron log                  # tail -f the app log (latest 100 lines first)
dsh electron log -n 500           # tail -f with more history
```

`stop` reads the recorded pid, sends a graceful `SIGTERM` first, escalates to `SIGKILL` after a three-second grace period, and removes the pid file; a stale pid (process already gone) is cleaned up silently. A second `start` while one instance is live fails loud instead of stacking a second window. The app's own main file boots the `web` profile inside a window, so the browser and the desktop surfaces share every requested plugin tree; nothing about that tree lives in the launcher process.

The desktop app mounts no new launcher flags: profile layers come from the same `$DSH_HOME/profiles/web` stack, and the `webserver`/`web-runtime` rows are overlaid by the app's own `config/electron.patch.yml` (loopback host, OS-assigned port, URL line and surface persona disabled). Because the desktop app package is private and unreleased, `dsh electron` is a repository-only surface; an installed `dsh` without the desktop package fails loud with the missing-package message instead of a silent no-op. On systems without POSIX `tail`, `dsh electron log` reports the missing tool instead of swallowing the request.

Process shutdown gives the plugin tree up to five seconds to dispose. The first `SIGINT`/`SIGTERM` starts that graceful drain — `SIGTERM` is a supervisor's ordinary stop request and exits 0 on every surface, `SIGINT` reports 130; a second signal forces immediate exit. If one-shot normal completion is already stuck in disposal, the first `Ctrl+C` is the escalation and exits immediately instead of being swallowed.

All modes treat the invoking directory as the default workspace root, load applicable `AGENTS.md` or `CLAUDE.md` instructions with a 65,536-byte render budget, and use an in-memory SQLite session content index. Every profile boot watches valid edits of both `cordis.patch.yml` layers (profile and home) and reapplies them transactionally; a one-shot surface exits through its bounded shutdown, which disposes the watchers.

New sessions default to the `workspace-write` permission preset. Bash and filesystem mutations are restricted to the session workspace and platform temporary roots; reads and network access are not confined, while process visibility depends on the selected sandbox backend — bwrap runs commands in a private PID namespace that hides host processes, and Landlock and Seatbelt leave host process visibility unchanged. `DSH_PERMISSION_MODE` changes the process fallback. Stored General-settings permissions affect later Web sessions, not an already-open one.

`DSH_TOOLS_MODE` selects `native`, `code`, or `both` for the process; another value fails at boot. The shipped `minimal` agent preset keeps that deployment presentation, fixes the complete system prompt to `You are a helpful software engineer assistant.`, and composes only persistent `bash` plus `str_replace_editor`. Select 极简模式 when creating a Web session; every other prompt section and model-facing plugin remains absent from that agent while the shared browser, workspace, persistence, sandbox, and permission host stays in place.

## Shared deployment behavior

The base bundle mounts the native DeepSeek adapter, settings and credential providers, stable `web_search`, and disabled session telemetry. Provider credentials resolve from the inherited environment, `$DSH_HOME/.credentials.yaml`, the invoking directory's `.env`, then `$DSH_HOME/.env`; the managed document is never materialized into `process.env`, while both `.env` files are ordinary launch environment layers. Search uses `DEEPSEEK_API_KEY` and accepts `DEEPSEEK_SEARCH_BASE_URL`; `web_fetch` is disabled unless a patch layer inserts a provider and enables it.

Session telemetry stays local by default. `DSH_TELEMETRY_MODE=FULL` streams every projected session event as OTLP/HTTP logs, while `DSH_TELEMETRY_MODE=FEEDBACK_ONLY` uploads a session-log suffix only when feedback is recorded. `DSH_TELEMETRY_OTLP_URL` selects another collector, and any non-empty `DSH_TELEMETRY_DISABLED` remains an authoritative hard opt-out. The shipped base has no telemetry redaction rule, so explicitly enabled exports can contain message text, tool arguments and results, and workspace paths; the [default-off Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md) owns that deployment decision.

Install external plugin bundles through `dsh plugin --profile <name> add <package-or-git-spec>`. The installed package owns its dependencies and contributes its declared `cordis.patch.yml` layer. The CLI also ships `@deepseek-ai/dsh-mcp-client` as a dependency for patch layers, but no MCP server is enabled by default because each server command is trusted executable code outside the agent sandbox.

## Source execution

From the repository root, run `pnpm run build` separately after a fresh checkout and whenever artifacts need updating, then use `pnpm dsh <args...>`. The `package.json` script launches `apps/cli/src/bin.ts` with `node --import tsx/esm` without building and forwards every argument. Missing Typert host artifacts fail profile boot through module-resolution errors without a build instruction. Once those host artifacts exist, missing frontend or client-plugin bundles fail at startup with an instruction to run `pnpm run build`. The launcher does not check freshness, so existing stale bundles can run older browser code until rebuilt. The process inherits the launch environment; set `NODE_USE_ENV_PROXY=1` when a supporting Node version must honor `HTTP_PROXY` and `HTTPS_PROXY`. The installed form launches the built `apps/cli/lib/bin.js` without rebuilding the repository.
