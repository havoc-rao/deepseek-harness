# @deepseek-ai/dsh-client-ui-terminal

[English](README.md) | 中文

`dsh web` UI 的浏览器终端面板。注册一个 additive `shell.overlay` 面板，挂载 xterm.js 实例和 `useTerminalSocket` hook。该 hook 打开到 `/api/terminals` 的 WebSocket，发送 spawn 帧，将击键转为 Input 帧，并将 Output 帧写入终端。Resize 和 Signal 帧保持 PTY 几何和控制流与 host 桥接（[`dsh-host-terminal-web`](../../host/terminal-web/README.md)）同步。双端使用共享 [`dsh-terminal-protocol`](../../util/terminal-protocol/README.md) 帧协议通信。

渲染器从 WebGL（硬件加速）启动，在 3 次 GPU context 丢失重建后回退到 CanvasAddon。主题重投影在 `useLayoutEffect` 中从 `document.body` 读取计算 CSS 变量，使 xterm 调色板在同一绘制帧内采用设计系统主题——无白闪。使用三个 xterm 5.5.x 私有 API slot（`_renderRows`、`scrollToBottom`、`_store`）进行强制重绘、钉底补丁和 WebglAddon dispose 垫片；升级 xterm 或 addon-webgl 需回归本模块。设计原理见[终端渲染器 Agent Note](../../../.agents/notes/implemented/feature/2026-08-14-terminal-renderer-webgl-theme.md)。

## Model Experience

None, as this package serves the browser terminal surface and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **xterm 私有 API 版本锁**——使用三个 5.5.x 私有 slot；xterm 或 addon-webgl 升级是刻意回归点，而非即插即用。
- **WebglAddon dispose 垫片为临时措施**——addon-webgl 0.19.0 读取 xterm 6 字段（`_store._isDisposed`），该字段在 xterm 5.5.x 上不存在；垫片植入哨兵。xterm 与 addon-webgl 版本对齐后应移除垫片。
- **无会话持久化**——重连开启新 shell；面板不从先前会话恢复 scrollback。
