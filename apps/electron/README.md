# dsh Electron desktop app

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

## Notes

- No packaging yet (electron-builder/forge); `pnpm run dev` runs from source.
