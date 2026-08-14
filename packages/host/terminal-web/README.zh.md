# @deepseek-ai/dsh-host-terminal-web

[English](README.md) | 中文

将浏览器终端面板连接到真实 PTY 的 host 端 WebSocket 桥接，通过 `ctx.subprocess.spawnTerminal` 启动。在 `ctx.webServer` 上注册一个 `/api/terminals` WebSocket upgrade；upgrade 复用与下行 carrier 相同的浏览器信任栅栏（`dsh-client-connection` 的 `isTrustedApiRequest`）：loopback 始终受信任，配置的 `trustedHosts` 扩展授权，其余 Host 在协商前 403 拒绝。

每个升级后的 socket 成为一个 `TerminalSocket`，解码来自共享 [`dsh-terminal-protocol`](../../util/terminal-protocol/README.md) 的帧，启动一个 PTY，以背压水位（512 KiB 暂停 / 256 KiB 恢复）向 client 泵送输出，并将 input/resize/signal 帧回传给 handle。一个 socket 即一个 PTY 生命周期——断开即终止 pty，重连则开启新 shell。该桥接绕过 `ctx.terminals`（owner 作用域、面向模型的注册表），因为浏览器→PTY 直连 surface 既不持有 agent 作用域授权，也不持有模型可见的持久性。设计原理见[浏览器交互终端 seam Agent Note](../../../.agents/notes/implemented/architecture/2026-08-14-browser-interactive-terminal-seam.md)。

## Model Experience

None, as this package serves the browser terminal surface and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **无会话持久化**——WebSocket 断开即终止 PTY；重连开启新 shell。浏览器标签页生命周期拥有会话边界，而非 host。
- **浏览器信任栅栏之外无认证**——upgrade 依赖 `isTrustedApiRequest`（loopback 或配置的 `trustedHosts`）；没有按会话的 token 或用户身份。LAN 部署必须审慎配置 `trustedHosts`。
- **单 socket 单 PTY**——协议支持每个 WebSocket 一个 PTY；在一个连接上复用多个 shell 需要协议扩展。
