# 浏览器交互终端 — 模块说明

dsh web 浏览器交互终端的三个包：共享帧协议、host 桥接、client 终端面板。

---

## 1. 共享帧协议 `@deepseek-ai/dsh-terminal-protocol`

**路径**：`packages/util/terminal-protocol/`

零依赖二进制帧协议，host 桥接和浏览器 client 逐字共享。一条 WebSocket 消息即一帧：1 字节 opcode + opcode 专属 payload。不依赖 DOM 或 Node，可内联到浏览器 bundle。

### 帧类型

| 方向 | Opcode | 名称 | Payload |
|---|---|---|---|
| client→server | 0x01 | Open | UTF-8 JSON `TerminalSpawnSpec` |
| client→server | 0x02 | Input | 原始 UTF-8 终端输入字节 |
| client→server | 0x03 | Resize | 2×Uint16LE (cols, rows) |
| client→server | 0x04 | Signal | 1×Uint8 信号编号 |
| client→server | 0x05 | Ack | 4×Uint32LE 已消费字节水位 |
| server→client | 0x81 | Output | 原始 UTF-8 终端输出字节 |
| server→client | 0x82 | Exit | 1×Uint8 退出码 + 1×Uint8 信号 |
| server→client | 0x83 | Error | UTF-8 错误消息 |

### 关键常量

- `TERMINAL_MAX_DIMENSION = 512`：cols/rows 的含上限，在 WS 边界校验。
- `TERMINAL_SIGNAL_BYTES`：5 个信号名→编号映射（SIGHUP=1, SIGINT=2, SIGKILL=9, SIGTERM=15, SIGTSTP=20）。

### 源文件

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 全部协议逻辑：帧编解码、spawn spec 校验、resize/signal/ack 编解码 |

### 设计约束

- 一个 socket = 一个 PTY 生命周期，不支持会话恢复。
- 整数一律小端编码。
- 维度（cols/rows）在 WS 边界校验为 1..=512 的整数。

---

## 2. Host 桥接 `@deepseek-ai/dsh-host-terminal-web`

**路径**：`packages/host/terminal-web/`

在 `ctx.webServer` 上注册 `/api/terminals` WebSocket upgrade，每个升级后的 socket 成为一个 `TerminalSocket`，将浏览器帧桥接到 `ctx.subprocess.spawnTerminal` 启动的 PTY。

### 浏览器信任栅栏

upgrade 复用 `dsh-client-connection` 的 `isTrustedApiRequest`：

- loopback 始终受信任
- 配置的 `trustedHosts` 扩展授权
- 其余 Host 在协商前 403 拒绝

配置字段：

```ts
interface Config {
  trustedHosts: string[]
}
```

### 背压机制

双端共享相同水位：

- `OUTPUT_PAUSE_WATERMARK = 512 KiB`：未确认输出超过此值时暂停 pty 输出流
- `OUTPUT_RESUME_WATERMARK = 256 KiB`：未确认输出降到此值以下时恢复

client 通过 Ack 帧上报已消费字节数（4×Uint32LE），host 以 `Math.max` 抬高确认水位。

### 源文件

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口：注册 upgrade 路由、管理 WebSocketServer 生命周期 |
| `src/terminal-socket.ts` | TerminalSocket 类：帧分发、spawn、output 泵送、背压、生命周期清理 |
| `src/invariant.ts` | 测试不变量 companion（无运行时 invariant） |

### 生命周期

- **Open 帧** → 校验 spawn spec → `ctx.subprocess.spawnTerminal` → 绑定 output 流
- **Input/Resize/Signal 帧** → 转发到 PTY handle（spawn 未完成时排队）
- **socket close** → terminate PTY（failsafe）
- **PTY exit** → 发送 Exit 帧 → 关闭 socket

### 与 `ctx.terminals` 的关系

桥接**绕过** `ctx.terminals`（owner 作用域、面向模型的注册表），因为浏览器→PTY 直连 surface 不持有 agent 作用域授权，也不持有模型可见的持久性。

---

## 3. Client 终端面板 `@deepseek-ai/dsh-client-ui-terminal`

**路径**：`packages/client/ui-terminal/`

浏览器侧终端面板，注册到 `shell.overlay` 槽位。挂载 xterm.js 实例，通过 WebSocket 收发协议帧。

### 源文件

| 文件 | 职责 |
|---|---|
| `src/index.ts` | host 端空插件体（仅占位让插件加载到 cordis.yml） |
| `src/client/index.ts` | client 插件入口：注册字典 + `shell.overlay` 槽位 |
| `src/client/TerminalPane.tsx` | 面板容器：开/关状态、Escape 关闭、挂载 TerminalView |
| `src/client/TerminalView.tsx` | xterm 装配：WebGL 渲染器、主题重投影、滚轮钉底、状态栏 |
| `src/client/useTerminalSocket.ts` | WebSocket hook：帧分发、重连退避、背压水位 |
| `src/client/useTerminalLayout.ts` | FitAddon + ResizeObserver：32ms 防抖几何同步 |
| `src/client/terminal-theme.ts` | CSS 变量 → xterm ITheme 映射 |
| `src/client/theme-source.ts` | `ctx.theme` → `HostObservable<ThemeSnapshot>` 适配器 |
| `src/client/locales.ts` | 中英文字典 |

### 渲染器策略

1. 启动 WebGL（硬件加速）
2. GPU context 丢失时重建 WebglAddon，预算 `WEBGL_RECOVERY_BUDGET = 3`
3. 超预算后回退到 CanvasAddon
4. WebGL 完全不可用时立即回退到 Canvas

### xterm 私有 API 版本锁（5.5.x）

| API | 用途 |
|---|---|
| `_core._renderService._renderRows` | FitAddon resize 后强制立即重绘，绕过渲染去抖器 |
| `_core.scrollToBottom` | 钉底补丁：用户未上滚时钉在底部，上滚后变 no-op |
| `_core._store` | addon-webgl 0.19.0 dispose 垫片：植入 `_isDisposed: true` 哨兵 |

升级 xterm 或 addon-webgl 需回归本模块。

### 主题联动

- `theme-source.ts` 从 `ctx.theme.getTheme()` + `ctx.on('theme/change')` 创建 `HostObservable`
- 经 `shell.overlay` 的 `inject: { hooks: { theme } }` 仓室传入 React
- `TerminalView` 的 `useLayoutEffect` 读取 `document.body` 计算 CSS 变量 → 写入 `term.options.theme` → `forceRender`
- 无白闪：`useLayoutEffect` 在 DOM commit 后、浏览器绘制前同步运行

### 重连策略

- 指数退避：1s → 2s → 4s → 8s → 上限 10s
- 重连时重置字节计数器，重新发送 Open 帧（新 shell）
- clean exit（Exit 帧）不重连
- unmount 时发送 SIGTERM 帧后关闭 socket

---

## 数据流总览

```
Browser (xterm.js)
  │
  │  WebSocket /api/terminals
  ▼
Host upgrade (isTrustedApiRequest fence)
  │
  ▼
TerminalSocket（帧分发 → spawn → 泵送 → 背压）
  │
  ▼
ctx.subprocess.spawnTerminal（node-pty）
  │
  ▼
OS shell（bash/zsh/powershell）
```

反向：shell output → PTY output stream → `sendOutput` → Output 帧 → WebSocket → xterm `term.write`

---

## 测试覆盖

| 测试文件 | 数量 | 覆盖内容 |
|---|---|---|
| `protocol.spec.ts`（`util/terminal-protocol`） | 24 | 帧编解码、spawn spec 校验、维度边界 |
| `terminal-socket.spec.ts`（`host/terminal-web`） | 11 | 帧分发、生命周期、背压水位、排队刷新 |
| `terminal-upgrade.spec.ts`（`host/terminal-web`） | 5 | upgrade 注册/移除、trustedHosts fence、socket 握手 |
| `flow-control.client.spec.tsx`（`client/ui-terminal`） | 4 | 输出写入、ack 水位、暂停/恢复、重连计数器重置 |
| `terminal-view.client.spec.tsx`（`client/ui-terminal`） | 19 | WebGL 恢复/回退、主题重投影、状态、清理、布局防抖 |

总计 63 个测试。

---

## Agent Notes

- [浏览器交互终端 seam](../../.agents/notes/implemented/architecture/2026-08-14-browser-interactive-terminal-seam.md) — 三包 seam 设计决策
- [终端渲染器 WebGL/主题](../../.agents/notes/implemented/feature/2026-08-14-terminal-renderer-webgl-theme.md) — 渲染器、GPU 恢复、主题联动决策
