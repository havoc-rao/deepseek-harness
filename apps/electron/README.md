# dsh Electron desktop app

English | [中文](README.zh.md)

A desktop shell for the dsh web client. It reuses the shared `web` profile —
the same host plugin tree `dsh web` runs. The renderer loads the host
webserver directly at `http://127.0.0.1:<port>`, so same-origin `fetch`,
WebSocket downlink, and module scripts all work without CORS or a custom
scheme bridge.

## Architecture

```
┌───────────────────────── main process ─────────────────────────┐
│  shimLoaderInternal() — Electron-safe loader.internal shim      │
│  startHost() — boot the shared 'web' profile                    │
│    webserver: 127.0.0.1:<os-assigned-port>                      │
│    healProfilesModuleFallback → ~/.dsh/profiles/node_modules    │
│  createWindow(host.url)                                         │
│    loadURL(http://127.0.0.1:<port>/)                            │
└─────────────────────────────────────────────────────────────────┘
   renderer: http://127.0.0.1:<port>/ (sandboxed, no node)
     same-origin fetch / WebSocket / <script> modules
```

Notes on the two main-process quirks:

- **`loader.internal` shim**: the `node-addon-require-builtin` addon that
  exposes Node's internal module loader cannot load inside Electron's embedder
  (it needs a `GetAlignedPointerFromEmbedderData` symbol only plain Node
  exports). `host.ts` swaps in a `createRequire(base)`-based shim so the
  config tree's bare package names resolve against the profile directory.
- **Healed profile modules**: `healProfilesModuleFallback` links the web
  profile's dependency tree into `~/.dsh/profiles/node_modules` (as the CLI
  does), which is where the tree resolves bare names from.

The hostname is loopback, so the client's location-based checks (`isLoopback`
for host-backed settings and path opening) behave exactly as in a browser.
`config/electron.patch.yml` pins the webserver to loopback with an OS-assigned
port and disables the web shell's URL line and surface persona.

## Run

From the repo root (or inside this package):

```sh
pnpm run electron:dev       # dev: build (tsc + tsdown) then `electron .`
pnpm run electron:build     # build only: emit lib/ artifacts
pnpm run electron:start     # run the built artifacts (`electron .`, no rebuild)
pnpm run cli:web            # alternative: boot the web UI via the built CLI
```

`electron:start` assumes a prior `electron:build` (or repo `pnpm run build`).
`electron:dev` sets `DSH_ELECTRON_DEV=1`, which adds a `(dev)` suffix to the
window title; `electron:start` runs without it.
Prerequisites: a prior full repo build (`pnpm run build`) so the web
frontend dist and plugin bundles exist. The shared profile comes from
`dsh web` (`~/.dsh/profiles/web`); user patch edits apply on relaunch — the
desktop app deliberately skips the CLI's config HMR.

## Package into a macOS app

`pnpm run pack` builds `dist/release/dsh.app` — a self-contained `.app` you can
drag into `/Applications` (ad-hoc signed, so it opens locally; `osascript` or
right-click → Open bypasses Gatekeeper after copy). `pnpm run pack:dmg` also
produces `dist/release/dsh-<version>.dmg` via the system `hdiutil`.

The pack pipeline (`scripts/pack-dist.mjs`) deliberately needs no
electron-builder or forge: it `pnpm deploy`s the workspace dependency closure
into `dist/pack`, mounts it at `Contents/Resources/app/`, re-points the copied
Electron runtime's `Info.plist` at the `dsh` identity, renames the main binary
to `dsh`, and swaps in the app icon. `asar` is intentionally unused — the
desktop host resolves its plugin closure through real paths and
`healProfilesModuleFallback` symlinks packages into `~/.dsh`.

Prerequisites: built `lib/` artifacts (`pnpm run build`) and the installed
workspace (`pnpm install`). A pre-existing `dist/` aborts the pack (fresh
output only); delete it manually to rebuild.

To distributable, sign + notarize the produced bundle with a Developer ID
(`codesign --deep --options runtime --entitlements ...` then
`notarytool submit`) — the pipeline leaves the bundle unsigned by default.

## Notes

- `pnpm run dev` runs from source; the pack is the distribution path.
- `Cmd+W` asks for confirmation before closing: the window intercepts the
  shortcut and shows a native dialog (default Cancel), because closing ends
  the running host session. Other close paths (window button, `Ctrl+W` on
  Windows/Linux) are not intercepted.
- Shell shortcuts route through `src/shortcuts.ts`: a main-process plugin can
  claim `Cmd+W` by registering a handler on `ctx.desktopShortcuts`; an
  unclaimed press keeps the confirmation dialog.
