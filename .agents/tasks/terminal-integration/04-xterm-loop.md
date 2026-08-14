# 模块 04 — xterm 最小闭环

**状态：🚧 代码完成**（typecheck / purity / css 门禁绿，待手动验证）

## 目标

在面板内完成最小可交互闭环：xterm 渲染 shell 输出，键盘输入回传 PTY。不做任何优化（丝滑属模块 05/06）。

## 范围

- `src/client/TerminalView.tsx`：xterm 实例装配 + 生命周期。
- `src/client/useTerminalSocket.ts`：WS 客户端（帧编解码、open/input/exit/error 处理、基础重连）。
- `src/client/terminal.module.css`：自写最小 xterm 样式（容器、viewport、屏幕布局）。
- **不做**：FitAddon/ResizeObserver（模块 05）、背压 ack（模块 05）、WebGL（模块 06）。

## 关键实现要点

- **TerminalView 生命周期**：
  - `useEffect` 里 `new Terminal({ ... })`（cursorBlink、fontFamily 先用系统等宽栈、theme 深色），`term.open(container)`，`term.onData((data) => ws.sendInput(data))`。
  - WS 回调里 `term.write(output)`；`Exit`/`Error` 帧 → 展示状态并停写。
  - cleanup：dispose xterm + 关 WS + 发送 terminate 帧（PTY 终止，防僵尸）。
- **useTerminalSocket**：
  - URL：`ws://` + `location.host` + `/api/terminals`（`dsh web --port` 自动反映到 `location.host`）。
  - 连接后发送 `open` 帧（spawn spec：cols/rows 初值 80×24，env 建议带 `TERM: 'xterm-256color'`）。
  - 帧解析：`readFrameOpcode` + `framePayload`；`Output` → 回调；`Exit`/`Error` → 回调 + 关闭。
  - 指数退避重连（基础版：`min(1s * 2^n, 10s)`），重连成功后重放 `open` 帧。
  - 复用共享协议包 `@deepseek-ai/dsh-terminal-protocol` 的编解码，禁止手写。
- **ws 依赖**：client bundle 内用浏览器原生 `WebSocket`，无需额外依赖。

## 实施步骤

- [x] `useTerminalSocket.ts`：连接 + open 重放 + output/exit/error 分发 + 基础重连。
- [x] `TerminalView.tsx`：xterm 装配、onData→input、output→write、dispose 清理。
- [x] `terminal.module.css`：最小样式。
- [ ] 打通后手动验证。

## 验收标准

- [ ] 打开面板自动起 shell（默认 shell 或 spec.command）。
- [ ] 敲命令（如 `ls`、`echo hi`）有回显，PTY 进程真实存在。
- [ ] 断开（host 重启）后自动重连并起新 shell。
- [ ] 关闭面板后 `ps` 确认无残留 PTY 进程。

## 风险与注意

- **Terminal 首次 open 尺寸**：初值 80×24，与 `open` 帧一致；真实尺寸适配在模块 05。
- **重连不恢复会话**：一个 socket = 一个 PTY 生命周期，断开即重起 shell（产品决策，不承诺持久化）。
- **日志**：不记录终端内容（可能含敏感输入），只记连接/断开/错误摘要。
