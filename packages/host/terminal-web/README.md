# @deepseek-ai/dsh-host-terminal-web

English | [中文](README.zh.md)

Host-side WebSocket bridge that connects a browser terminal pane to a real PTY through `ctx.subprocess.spawnTerminal`. Registers one `/api/terminals` WebSocket upgrade on `ctx.webServer`; the upgrade applies the same browser-trust fence (`isTrustedApiRequest` from `dsh-client-connection`) as the downlink carriers: loopback is always trusted, configured `trustedHosts` extend the grant, every other Host is 403 before negotiation.

Each upgraded socket becomes a `TerminalSocket` that decodes frames from the shared [`dsh-terminal-protocol`](../../util/terminal-protocol/README.md), spawns one PTY, pumps output to the client with backpressure watermarks (512 KiB pause / 256 KiB resume), and feeds input/resize/signal frames back to the handle. One socket is one PTY lifetime — a drop terminates the pty, and reconnect opens a fresh shell. The bridge bypasses `ctx.terminals` (the owner-scoped, model-facing registry) because a direct browser→PTY surface owns neither agent-scoped authorization nor model-visible durability. Design rationale lives in [the browser-interactive terminal seam Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-browser-interactive-terminal-seam.md).

## Model Experience

None, as this package serves the browser terminal surface and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No session persistence** — a WebSocket drop terminates the PTY; reconnect opens a fresh shell. Browser-tab lifecycle owns the session boundary, not the host.
- **No authentication beyond the browser-trust fence** — the upgrade relies on `isTrustedApiRequest` (loopback or configured `trustedHosts`); there is no per-session token or user identity. LAN deployments must configure `trustedHosts` deliberately.
- **Single PTY per socket** — the protocol supports one PTY per WebSocket; multiplexing multiple shells over one connection would require a protocol extension.
