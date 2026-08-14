# @deepseek-ai/dsh-client-ui-terminal

English | [中文](README.zh.md)

Browser-side terminal pane for the `dsh web` UI. Registers an additive `shell.overlay` pane that mounts an xterm.js instance and a `useTerminalSocket` hook. The hook opens a WebSocket to `/api/terminals`, sends the spawn frame, forwards keystrokes as Input frames, and writes Output frames into the terminal. Resize and Signal frames keep the PTY geometry and control flow in sync with the host bridge ([`dsh-host-terminal-web`](../../host/terminal-web/README.md)). Both sides speak the shared [`dsh-terminal-protocol`](../../util/terminal-protocol/README.md) frame contract.

The renderer starts on WebGL (hardware-accelerated) and falls back to CanvasAddon after 3 GPU context-loss rebuilds. Theme re-projection reads computed CSS variables from `document.body` in a `useLayoutEffect` so the xterm palette adopts the design-system theme in the same paint frame — no white flash. Three xterm 5.5.x private API slots (`_renderRows`, `scrollToBottom`, `_store`) are used for forced repaint, pin-to-bottom patching, and a WebglAddon dispose shim; upgrading xterm or addon-webgl requires regressing this module. Design rationale lives in [the terminal renderer Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-terminal-renderer-webgl-theme.md).

## Model Experience

None, as this package serves the browser terminal surface and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **xterm private API version lock** — three 5.5.x private slots are used; an xterm or addon-webgl upgrade is a deliberate regression point, not a drop-in.
- **WebglAddon dispose shim is temporary** — addon-webgl 0.19.0 reads an xterm 6 field (`_store._isDisposed`) that is absent on xterm 5.5.x; the shim plants a sentinel. Remove the shim when xterm and addon-webgl are version-aligned.
- **No session persistence** — reconnect opens a fresh shell; the pane does not restore scrollback from a previous session.
