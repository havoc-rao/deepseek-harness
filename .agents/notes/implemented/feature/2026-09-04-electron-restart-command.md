# Agent Note: `dsh electron restart` relaunches the desktop app from any recorded state

Status: implemented

English | [中文](2026-09-04-electron-restart-command.zh.md)

## Problem

`dsh electron` could start and stop the desktop app, but no single command relaunched it. A composed `dsh electron stop` + `dsh electron start` failed exactly when a restart matters most: `stop` errors on a missing pid file ("nothing to stop"), `start` refuses a live instance ("already running"), and nothing waits for the old process to exit before the next spawn. After a crash (stale pid), on a first-ever start (no pid file), or with a healthy instance, the two-command recipe either errored or demanded manual coordination. A restart executed inside the invoking CLI additionally depends on that process surviving the stop: once the old instance is terminated, the invoking session's teardown (terminal close, session reaping) can discard the CLI before it reaches the launch, leaving the app dead with no relaunch.

## Decision

`dsh electron restart [args...]` in `apps/cli` joins `start`/`stop`/`log` as a first-class launcher action. The command itself never consults whether an instance is supposed to be running: it pre-validates the desktop app and its binary on the terminal, then throws the stop-then-launch sequence out as a detached supervisor — this same CLI re-executed (`electron restart` again) under the internal `DSH_ELECTRON_RESTART_SUPERVISOR` env marker, whose output appends to the same electron log. The command returns immediately after printing the supervisor pid; the old instance's teardown or a closing invoking session cannot discard the pending launch.

The supervisor body runs the sequence inline and stays state-independent, always ending in a fresh launch:

- no pid file — prints `no electron pid file — starting fresh` and launches;
- stale pid — the shared `stopDaemon` removes the file and the launch proceeds;
- live pid — the shared SIGTERM→SIGKILL protocol runs and blocks until the old process is gone, then the launch proceeds.

Only a process that survives SIGKILL aborts the sequence (exit 1, nothing launched; the verdict lands in the log). The launch phase is the same private `launchElectron` that `startElectron` uses (app-dir check, binary check, already-running guard, log open, pid write), so failure ordering and messages stay identical to `start`; the guard is vacuous on the restart path because the stop phase removed the old pid file first. Arguments after `restart` forward to the Electron main process exactly like `start` (`dsh electron restart --dev`), including the default already-running message that references `dsh electron stop`. The self-relaunch command (`execPath` + entry script + loader hooks) moved from `web.ts`'s private `WebLauncher`/`resolveWebLauncher` into the shared `daemon.ts` as `SelfLauncher`/`resolveSelfLauncher`, which both launchers now use.

## Alternatives considered

**Run the stop-then-launch sequence inside the invoking CLI process.** Rejected: that execution depends on the invoking process surviving between stop and start — a session close or the old instance's teardown discards it first, exactly the "stopped but never relaunched" failure this command exists to fix; the detached supervisor is independent of both.

**Compose `stop` + `start` in the CLI.** Rejected: it keeps the state dependence — "nothing to stop" and "already running" error on exactly the states restart exists to fix — and the hand-off needs the stop phase to block until the old process exits, which a bare `stop` does not guarantee before the next command's spawn.

**Documented shell recipe (`stop || true; start`).** Rejected: the recipe hides the exit-wait, prints the confusing `stop` errors it suppresses, and carries no tests; a first-class action owns the protocol, the messages, and the timeout injection used by the unit suite.

## Consequences

One command now recovers every recorded state — no pid, stale pid, healthy instance, SIGTERM-ignoring instance — from a process that cannot be discarded by the stop; it only fails when the old process survives SIGKILL, so a restart can never silently stack a second window. The cost is that the restarted app's launch and any failure verdict appear in the log rather than on the invoking terminal (misconfiguration still fails loud before dispatch), and the stop phase may wait up to the SIGTERM grace (default 3s) inside the supervisor, the same worst case `dsh electron stop` already documents. `dsh web` keeps its separate `stop`-only surface; the shared `daemon.ts` stop protocol gained no changes besides hosting the self-relaunch command.