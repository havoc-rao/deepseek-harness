# `dsh web` becomes a pid launcher; `--dev` keeps the foreground boot

English | [中文](2026-08-19-dsh-web-pid-launcher.zh.md)

Date: 2026-08-19

## Change

The `apps/cli` `dsh web` semantics changed from a foreground `--profile web` alias to a **pid launcher**: the bare command relaunches `dsh --profile web <args>` as a detached background process, records the pid in `$DSH_HOME/web.pid`, appends output to `$DSH_HOME/web.log`, and returns to the terminal immediately. `dsh web stop` runs the SIGTERM→SIGKILL protocol (reusing the electron stop logic). **`dsh web --dev` is the foreground boot** (the old in-process start, Ctrl+C disposes in place) — the launcher parses and strips `--dev` itself, never forwarding it to the web app.

## Key design

- **Launcher reuse** (`src/web.ts` `resolveWebLauncher`): the child is the current process's `process.execPath` + `argv[1]` (entry script) + loader switches. Under the dev launch `node --import tsx src/bin.ts` the loader pair must be **forwarded together** (`--import` + value), otherwise the child's plain node cannot load `.ts` sources (observed `bad option: --profile`: `--import` swallows the next argument, so the loader switch and its value must be collected as a pair). A built-bin (lib) launch carries no loader.
- **Shared daemon protocol** (`src/daemon.ts`, new): `daemonStateFiles`/`readPid`/`isPidAlive`/`stopDaemon` extracted from electron.ts and shared by electron and web; `stopDaemon` supports injected stdout/stderr (tests).
- **URL readiness**: the web-app bundle's `dsh web: http://…` line appears only in the child's log, so the supervisor polls it for readiness (scripts/publish-npm-baseline and the web e2e both switched to foreground `--dev` to read stdout).
- **args.ts**: the `web` subcommand action order = dump (boot-free) > `stop` > `--dev`/`-h` (foreground profile boot) > bare command (pid launcher). `stop` with extra arguments errors.
- **Process semantics**: foreground `--dev` and the detached start are exactly equivalent (same profile boot path); `web stop` sends SIGTERM to the session process and the existing profile-boot disposer collects the tree gracefully. A stale/absent `web.pid` makes `stop` report "nothing to stop".

## Affected consumers (all migrated to `--dev` to keep foreground semantics)

- `apps/cli/tests/lazy-search-startup.compat.spec.ts` (built web probe)
- `apps/cli/tests/built-bin.e2e.ts` (the `--host 0.0.0.0` rejection path)
- `apps/web/tests/smoke-real.e2e.ts`, `hmr-live.e2e.ts` (spawn adds `--dev`)
- `scripts/publish-npm-baseline.ts` (POSIX python probe)

## Tests

`apps/cli/tests/web.spec.ts` (new, 31 items incl. args/electron, all green): the fake launcher uses a shebang binary (`#!node` + chmod) to avoid vitest's fork pool interfering with `spawn(node, [script])` — on this machine the CodeBuddy shim + vitest combination redirects node-spawned JS children into the vitest worker entry (`init-forks`); the binary is the same safe shape as electron.spec.
