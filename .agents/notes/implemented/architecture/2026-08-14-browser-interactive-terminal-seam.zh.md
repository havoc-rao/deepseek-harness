# Agent Note: 浏览器交互终端 seam

Status: implemented

[English](2026-08-14-browser-interactive-terminal-seam.md) | 中文

## Problem

`dsh web` 页面需要一个交互式终端——一个让用户直接敲入真实 shell 并看到实时 PTY 输出的面板。harness 已有 `ctx.terminals`（[持久 PTY 会话](../../../../docs/subsystems/terminal.md)）：一个带 agent 作用域授权、面向模型工具消费方、持有持久 scrollback 的 owner 作用域注册表。该 seam 为模型驱动 shell 并通过 `tool/call` 事件读取有界输出而设计——而非让浏览器以 60 fps 流式传输原始字节。把它用于浏览器 surface 会迫使每次击键穿过 agent inbox、每个输出块穿过一个会话事件，两者都不是直接人机交互的恰当粒度。

第二个问题是帧契约漂移：浏览器 client 与 Node host 使用自定义二进制 WebSocket 协议通信，必须在 opcode、整数编码和维度上限上保持一致。把协议放进一个包、双端各自 import，可防止一侧静默更改契约。

## Decision

交付一个三包 seam，绕过 `ctx.terminals`，将浏览器直接桥接到 `ctx.subprocess.spawnTerminal`（node-pty）：

- **`dsh-terminal-protocol`**（`packages/util/terminal-protocol`）——零依赖共享帧契约。一条 WebSocket 消息即一帧：一字节 opcode（client→server 0x01–0x05，server→client 0x81–0x83）后接 opcode 专属 payload。整数一律小端；cols/rows 在 WS 边界校验为 1..=512 的整数（`TERMINAL_MAX_DIMENSION`）。该模块不依赖 DOM 或 Node，可内联到浏览器 bundle。
- **`dsh-host-terminal-web`**（`packages/host/terminal-web`）——在 `ctx.webServer` 上注册一个 `/api/terminals` WebSocket upgrade。upgrade 复用与下行 carrier 相同的浏览器信任栅栏（`dsh-client-connection` 的 `isTrustedApiRequest`）：loopback 始终受信任，配置的 `trustedHosts` 扩展授权，其余 Host 在协商前 403 拒绝。每个升级后的 socket 成为一个 `TerminalSocket`，解码帧、通过 `ctx.subprocess.spawnTerminal` 启动一个 PTY、向 client 泵送输出、并将 input/resize/signal 帧回传给 handle。
- **`dsh-client-ui-terminal`**（`packages/client/ui-terminal`）——注册一个 additive `shell.overlay` 面板。面板挂载 xterm 实例和 `useTerminalSocket` hook，后者打开 WebSocket、发送 spawn 帧、将击键转为 Input 帧、并将 Output 帧写入终端。

### 一个 socket = 一个 PTY 生命周期

WebSocket 断开即终止 pty（host 的 close 回调调用 `handle.terminate()`；client 在 unmount 关闭前发送 SIGTERM）。重连开启新 shell——断开之间不持久化会话。这符合浏览器心智模型（关标签页即丢 shell），并避免了 `ctx.terminals` 持有的持久化、授权和 scrollback 机制。

### 背压对称

双端共享相同水位：512 KiB 未确认输出暂停流，256 KiB 恢复流。host 暂停其 pty 输出流；client 暂停 `term.write`。client 确认已消费字节数（4×Uint32LE），host 以 `Math.max` 抬高确认水位，故重复确认无害。两端必须同步，否则一侧积压而另一侧继续发送。

### 渲染器恢复

xterm 渲染器从 WebGL（硬件加速）启动。GPU context 丢失时重建 WebglAddon，预算 3 次后回退到 CanvasAddon。context 丢失预算防止 VRAM 压力下的无限重载循环。视图在 FitAddon resize 后和主题切换后通过 5.5.x 私有 `_core._renderService._renderRows` API 强制立即重绘，绕过渲染去抖器以避免单帧闪烁。

### 私有 API 版本锁

使用三个 xterm 5.5.x 私有 slot：`_core._renderService._renderRows`（强制重绘）、`_core.scrollToBottom`（钉底补丁）、`_core._store`（addon-webgl 0.19.0 读取的 xterm 6 字段的 dispose 垫片）。升级 xterm 或 addon-webgl 需回归本模块并 patch 测试；版本锁在各个调用点的 JSDoc 中记录。

## Alternatives considered

**把浏览器终端路由到 `ctx.terminals`。** 拒绝：`ctx.terminals` 是 owner 作用域（精确 `Agent` 授权）、面向模型（工具消费方）、持久的（scrollback、会话事件）。浏览器→PTY 直连 surface 不持有其中任何一项——用户不是 agent，击键不是工具调用，原始输出不是模型可见上下文。强行适配会引入 surface 不需要的授权和持久化机制，并让每个字节缓慢穿过会话日志。

**在 host 上引入新的 pty 库。** 拒绝：`ctx.subprocess.spawnTerminal`（node-pty）已提供桥接所需的 spawn/write/resize/signal/terminate 生命周期。新增第二个 pty 后端会复制执行世界并破坏"一次提供方替换搬动一切"的特性。

**跨重连持久化 PTY 会话。** 拒绝：浏览器标签页会关闭、网络会断开，重连 UI 背后挂着一个旧 shell 是 confused-deputy 风险。每次打开即新 shell 是浏览器终端的契约；持久化是 `ctx.terminals` 为模型驱动会话承担的职责。

**使用 JSON 文本帧代替二进制协议。** 拒绝：终端输出是任意字节（包括流中途的无效 UTF-8），base64 编码会使带宽翻倍并在大输出下增加分配压力。一字节 opcode 加原始 payload 是最小二进制分帧。

**在每个包内内联协议。** 拒绝：host 和 client 会各自漂移。共享包配自己的单测让帧契约变更在另一侧成为编译错误。

## Consequences

- 浏览器终端与面向模型的终端是独立 surface；替换 `ctx.terminals` 后端不影响它，反之亦然。
- `dsh-host-terminal-web` 向 host 新增一个 WebSocket upgrade 路由和一个运行时依赖（`ws`）；`dsh-client-ui-terminal` 向 client bundle 新增 xterm 及其 addon。
- xterm 私有 API 版本锁意味着 xterm 或 addon-webgl 升级是刻意回归点，而非即插即用。
- 背压调优需同时改两端；共享协议包记录了水位常量，但每端持有自己的副本（host 在 `terminal-socket.ts`，client 在 `useTerminalSocket.ts`），因为它们是进程本地配置，不是线上常量。
- 浏览器信任栅栏与 client-connection 下行链路共享，故 `trustedHosts` 需在两个插件间保持一致，LAN client 才能正常工作。
