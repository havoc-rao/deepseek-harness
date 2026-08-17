# Agent Note: `dsh electron` launcher mode

Status: implemented

English | [中文](2026-08-17-dsh-electron-launcher.zh.md)

## Problem

`dsh web` boots the shared `web` profile inside a plain Node process and opens the browser, while the Electron desktop app (`apps/electron`) previously had no CLI launcher of its own — only the monorepo's `pnpm --filter @deepseek-ai/dsh-electron run dev|start`. A desktop user had to leave the `dsh` surface or remember a pnpm invocation.

The desktop main process cannot be booted from plain Node: `apps/electron/src/main.ts` imports `app`/`BrowserWindow` from the `electron` package, which under plain Node exports only the binary path string, and `host.ts` needs `shimLoaderInternal()` because the embedder cannot load the node addon. So the desktop surface can never be a `--profile` boot; the correct shape is a launcher mode that resolves the Electron binary and spawns the app process.

## Decision

**Add `dsh electron` as a launcher command family** in the CLI (`apps/cli`), parallel to `dsh web`, with foreground replaced by a pid-driven start/stop/log lifecycle:

- `src/electron.ts` — `resolveElectronBinary(appDir)` resolves the `electron` devDependency of the desktop package by reading that package's `path.txt` (correct for both pnpm store layouts and hoisted node_modules). `startElectron(args)` spawns the binary detached with the desktop app directory as the app path, records the pid in `$DSH_HOME/electron.pid`, appends stdout/stderr to `$DSH_HOME/electron.log`, and returns after unref — an already-running instance fails loud instead of stacking a second window. `stopElectron()` reads the pid, sends `SIGTERM`, escalates to `SIGKILL` after a 3s grace period (test-injectable), and removes the pid file; a stale pid is cleaned silently. `tailElectronLog(lines)` runs POSIX `tail -f` and reports its absence loud on non-POSIX systems.
- `src/args.ts` — the `electron` subcommand parses the first token as the action (`start` is the default and elided; `stop`; `log` with `-n/--lines`), rejects parent options like the sibling subcommands (`--profile x electron` errors), and prints its own help for `-h/--help` rather than forwarding it.
- `src/bin.ts` — a new `'electron'` case dynamically imports the runner, keeping unrelated modes off the dispatch path.

The launcher resolves the app only in the repository layout (`../../electron/` from `apps/cli/src` or `apps/cli/lib` resolves to `apps/electron`); the desktop app boots the shared `web` profile through its own `startHost()` with its `config/electron.patch.yml` overlays. The browser and desktop surfaces therefore share every requested plugin tree, and `dsh electron` stays a thin façade over the electron package's CLI (working with `ELECTRON_OVERRIDE_DIST_PATH` and pnpm store layouts).

## Implementation notes

- The CLI remains the launcher, not a second profile boot: it never composes the profile, applies user or home layers, or watches patch files. All of that stays in the desktop main process, a mirror of `apps/cli/src/profile-boot.ts`.
- The pid/log state files live under the resolved `$DSH_HOME` (the same root as the profiles), named `electron.pid` and `electron.log`; both are injectable via `baseDir` for tests.
- `resolveElectronBinary` walks `node_modules` upward from the app dir and reads the electron package's installed `path.txt`; this deliberately never consults `NODE_PATH`/module-registry globals, so a bare app dir can never resolve an unrelated electron. The unit tests lay out the same shape (`package.json` + `index.js` + `path.txt` + `dist/<binary>`) and inject a fake binary plus app dir so the spawn, signal, and pid-file paths are covered without a real Electron. The SIGKILL-escalation test lets the fake boot (its argv marker settles) before signalling, so the fake's own SIGTERM trap is installed.
- Old build artifacts (`lib/types/electron-launch.*`) from earlier iterations are stale: the build is `tsc -b` + `tsdown` with `clean: false`, so a renamed module leaves an unreferenced chunk until a full clean build.

## Alternatives considered

**Reuse `dsh web`.** Rejected: `apps/electron/main.ts` requires Electron APIs and the window lifecycle, which plain Node cannot provide; the desktop host also needs the electron-specific loader shim.

**Boot the desktop host inside the CLI process.** Rejected: that would be a `--profile` boot in all but name and cannot create the OS window.

## Distribution: `dsh.app` pack (apps/electron)

`apps/electron/scripts/pack-dist.mjs` (`pnpm run pack`, `pack:dmg` with
`DSH_DMG=1`) assembles a self-contained `dist/release/dsh.app` — and optionally
a system-`hdiutil` DMG — without electron-builder or forge:

1. `pnpm --filter @deepseek-ai/dsh-electron deploy --prod --legacy --ignore-scripts dist/pack` materializes the workspace dependency closure (the `@deepseek-ai/dsh-*` bundles + vendored cordis) as a real `node_modules` tree.
2. Built `lib/`, `config/`, `assets/` and a pruned `package.json` (no devDeps) are copied in; build-only files (`src/`, scripts, manifests) are stripped from the payload.
3. The installed Electron runtime (`Electron.app`) is copied whole from the pnpm store, its `Info.plist` re-pointed at identity `ai.deepseek.dsh` / executable `dsh`, the main binary renamed `dsh`, `icon.icns` swapped in, and the staged tree mounted at `Contents/Resources/app/` (the `app.whenReady()` loadable app).

Key constraints discovered on the way:

- `pnpm deploy` needs `--legacy` because the workspace does not set `inject-workspace-packages`; legacy deploy **recreates the source package's node_modules**, pruning devDependencies — restore with `pnpm install` after packing. The staging install must be script-less (env `npm_config_ignore_scripts=true` is read by pnpm itself; the `--ignore-scripts` CLI flag is dropped for the nested `install --production`), otherwise the root workspace postinstall (lefthook install) fails on the dependency-only tree.
- `asar` is intentionally unused: the desktop host resolves its plugin closure through real paths (`healProfilesModuleFallback` symlinks into `~/.dsh`).
- The app ship is unsigned by default (ad-hoc); Developer ID signing + notarization is the documented path for external distribution.

## Consequences

The desktop surface gains a real `dsh electron` entry with deterministic binary resolution, pid-file-backed lifecycle, signal escalation, and the launcher's fail-loud behavior. Unit tests cover the argv layout (app dir first, then forwarded args), the pid-file lifecycle, SIGTERM-to-SIGKILL escalation (second fake whose trap survives), staleness cleanup, log pre-conditions, and the two failure paths. `apps/electron` now ships a reproducible `dsh.app`/DMG pipeline; `apps/cli/README`, `apps/cli/reference/README`, and the READMEs document it. `dsh electron` and the pack stay repository surfaces while `@deepseek-ai/dsh-electron` is private and unreleased.