# Agent Note: `dsh electron` launcher mode

Status: implemented

English | [中文](2026-08-17-dsh-electron-launcher.zh.md)

## Problem

`dsh web` boots the shared `web` profile inside a plain Node process and opens the browser, while the Electron desktop app (`apps/electron`) previously had no CLI launcher of its own — only the monorepo's `pnpm --filter @deepseek-ai/dsh-electron run dev|start`. A desktop user had to leave the `dsh` surface or remember a pnpm invocation.

The desktop main process cannot be booted from plain Node: `apps/electron/src/main.ts` imports `app`/`BrowserWindow` from the `electron` package, which under plain Node exports only the binary path string, and `host.ts` needs `shimLoaderInternal()` because the embedder cannot load the node addon. So the desktop surface can never be a `--profile` boot; the correct shape is a launcher mode that resolves the Electron binary and spawns the app process.

## Decision

**Add `dsh electron` as a spawn-only launcher mode** in the CLI (`apps/cli`), parallel to `dsh web`:

- `src/electron-launch.ts` — `resolveElectronBinary(appDir)` resolves the `electron` devDependency of the desktop package by reading that package's `path.txt` (correct for both pnpm store layouts and hoisted node_modules), and `runElectron(args)` spawns the binary with the desktop app directory as the app path, forwards `SIGINT`/`SIGTERM`, waits for the child, and returns its exit code (1 with a fail-loud message on any launch failure).
- `src/args.ts` — a new `electron` subcommand with a verbatim `[args...]` slot and the same parent-option rejection as the sibling subcommands (`--profile x electron` errors).
- `src/bin.ts` — a new `'electron'` case dynamically imports the runner, keeping unrelated modes off the dispatch path.

The launcher resolves the app only in the repository layout (`../../electron/` from `apps/cli/src` or `apps/cli/lib` resolves to `apps/electron`); the desktop app boots the shared `web` profile through its own `startHost()` with its `config/electron.patch.yml` overlays. The browser and desktop surfaces therefore share every requested plugin tree, and `dsh electron` stays a thin façade over the electron package's CLI (working with `ELECTRON_OVERRIDE_DIST_PATH` and pnpm store layouts).

## Implementation notes

- The CLI remains the launcher, not a second profile boot: it never composes the profile, applies user or home layers, or watches patch files. All of that stays in the desktop main process, a mirror of `apps/cli/src/profile-boot.ts`.
- `resolveElectronBinary` reads the electron package's installed `path.txt`; the unit test lays out the same shape (`package.json` + `index.js` + `path.txt` + `dist/<binary>`) and injects a fake binary plus app dir so the spawn path is covered without a real Electron.

## Alternatives considered

**Reuse `dsh web`.** Rejected: `apps/electron/main.ts` requires Electron APIs and the window lifecycle, which plain Node cannot provide; the desktop host also needs the electron-specific loader shim.

**Boot the desktop host inside the CLI process.** Rejected: that would be a `--profile` boot in all but name and cannot create the OS window.

## Consequences

The desktop surface gains a real `dsh electron` entry with deterministic binary resolution, exit-code propagation, signal forwarding, and the launcher's fail-loud behavior. Unit tests pin the argv layout (app dir first, then forwarded args), exit-code propagation, and the two failure paths (`desktop app not found` / `electron binary is not installed`). `apps/cli/README`, `apps/cli/reference/README`, and the help text document the mode; it remains a repository-only surface while `@deepseek-ai/dsh-electron` is private and unreleased.