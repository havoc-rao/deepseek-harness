# Agent Note: Browser-interactive terminal seam

Status: implemented
Archived: 2026-08-23

English | [中文](2026-08-14-browser-interactive-terminal-seam.zh.md)

## Problem

The `dsh web` page needs an interactive terminal — a pane where the user types into a real shell and sees live PTY output. The harness already has `ctx.terminals` ([persistent PTY sessions](../../../../docs/subsystems/terminal.md)): an owner-scoped registry with agent-scoped authorization, model-facing tool consumers, and durable scrollback. That seam is designed for the model to drive a shell and read bounded output through `tool/call` events — not for a browser to stream raw bytes at 60 fps. Using it for the browser surface would force every keystroke through the agent inbox and every output chunk through a session event, neither of which is the right grain for direct human interaction.

A second concern is frame-contract drift: a browser client and a Node host speaking a custom binary WebSocket protocol must agree on opcodes, integer encoding, and dimension limits. Putting the protocol in one package and importing it from both sides prevents one side from silently changing the contract.

## Decision

Ship a three-package seam that bypasses `ctx.terminals` and bridges the browser directly to `ctx.subprocess.spawnTerminal` (node-pty):

- **`dsh-terminal-protocol`** (`packages/util/terminal-protocol`) — zero-dependency shared frame contract. One WebSocket message is one frame: a one-byte opcode (client→server 0x01–0x05, server→client 0x81–0x83) followed by an opcode-specific payload. Integers are little-endian; cols/rows are validated at the WS boundary as integers in 1..=512 (`TERMINAL_MAX_DIMENSION`). The module is DOM- and Node-agnostic so it inlines into the browser bundle.
- **`dsh-host-terminal-web`** (`packages/host/terminal-web`) — registers one `/api/terminals` WebSocket upgrade on `ctx.webServer`. The upgrade applies the same browser-trust fence (`isTrustedApiRequest` from `dsh-client-connection`) as the downlink carriers: loopback is always trusted, configured `trustedHosts` extend the grant, every other Host is 403 before negotiation. Each upgraded socket becomes a `TerminalSocket` that decodes frames, spawns one PTY through `ctx.subprocess.spawnTerminal`, pumps output to the client, and feeds input/resize/signal frames back to the handle.
- **`dsh-client-ui-terminal`** (`packages/client/ui-terminal`) — registers an additive `shell.overlay` pane. The pane mounts an xterm instance and a `useTerminalSocket` hook that opens the WebSocket, sends the spawn frame, forwards keystrokes as Input frames, and writes Output frames into the terminal.

### One socket = one PTY lifetime

A WebSocket drop terminates the pty (the host's close handler calls `handle.terminate()`; the client sends SIGTERM before closing on unmount). Reconnect opens a fresh shell — there is no session persistence across drops. This matches the browser mental model (close the tab, lose the shell) and avoids the durability, authorization, and scrollback machinery `ctx.terminals` owns.

### Backpressure symmetry

Both ends share the same watermarks: 512 KiB outstanding unacked output pauses the stream, 256 KiB resumes it. The host pauses its pty output stream; the client pauses `term.write`. The client acks consumed bytes (4×Uint32LE), and the host raises its acked-watermark with `Math.max`, so repeats are harmless. The pair must stay in step or one side backs up while the other keeps sending.

### Renderer recovery

The xterm renderer starts on WebGL (hardware-accelerated). On GPU context loss it rebuilds the WebglAddon up to a budget of 3, then falls back to CanvasAddon. A context-loss budget prevents an unbounded reload loop under VRAM pressure. The view forces an immediate repaint via the 5.5.x private `_core._renderService._renderRows` API after a FitAddon resize and after a theme switch, bypassing the render debouncer to avoid a one-frame flicker.

### Private API version lock

Three xterm 5.5.x private slots are used: `_core._renderService._renderRows` (forced repaint), `_core.scrollToBottom` (pin-to-bottom patch), and `_core._store` (WebglAddon dispose shim for the xterm 6 field addon-webgl 0.19.0 reads). Upgrading xterm or addon-webgl requires regressing this module and patching the tests; the version lock is documented in JSDoc at each call site.

## Alternatives considered

**Route the browser terminal through `ctx.terminals`.** Rejected: `ctx.terminals` is owner-scoped (exact `Agent` authorization), model-facing (tool consumers), and durable (scrollback, session events). A direct browser→PTY surface owns none of those — the user is not an agent, keystrokes are not tool calls, and raw output is not model-visible context. Forcing the fit would add authorization and durability machinery the surface does not need and slow every byte through the session log.

**Introduce a new pty library on the host.** Rejected: `ctx.subprocess.spawnTerminal` (node-pty) already provides the spawn/write/resize/signal/terminate lifecycle the bridge needs. Adding a second pty backend would duplicate the execution world and break the "one provider swap moves everything" property.

**Persist PTY sessions across reconnects.** Rejected: browser tabs close, networks drop, and a stale shell behind a reconnecting UI is a confused-deputy risk. A fresh shell on every open is the browser-terminal contract; persistence is the job of `ctx.terminals` for model-driven sessions.

**Use JSON text frames instead of a binary protocol.** Rejected: terminal output is arbitrary bytes (including invalid UTF-8 mid-stream), and base64-encoding it doubles bandwidth and adds allocation pressure under large output. A one-byte opcode plus raw payload is the minimal binary framing.

**Inline the protocol in each package.** Rejected: the host and client would drift independently. A shared package with its own unit tests makes a frame-contract change a compile error on the other side.

## Consequences

- The browser terminal is a separate surface from model-facing terminals; swapping a `ctx.terminals` backend does not affect it, and vice versa.
- `dsh-host-terminal-web` adds one WebSocket upgrade route and one runtime dependency (`ws`) to the host; `dsh-client-ui-terminal` adds xterm and its addons to the client bundle.
- The xterm private-API version lock means an xterm or addon-webgl upgrade is a deliberate regression point, not a drop-in.
- Backpressure tuning requires changing both ends together; the shared protocol package documents the watermark constants but each side owns its own copy (the host in `terminal-socket.ts`, the client in `useTerminalSocket.ts`) because they are process-local configuration, not wire constants.
- The browser-trust fence is shared with client-connection downlinks, so `trustedHosts` must stay in step across both plugins for LAN clients.
