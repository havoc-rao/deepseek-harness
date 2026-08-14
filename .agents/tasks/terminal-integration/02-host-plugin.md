# 模块 02 — host 插件 `dsh-host-terminal-web`

**状态：✅ 已完成**

## 目标

在 host 侧暴露 `/api/terminals` WS 升级端点，把浏览器的二进制帧桥接到既有 `ctx.subprocess.spawnTerminal`（node-pty），并保证生命周期清理（无僵尸 PTY）。

## 范围

- 新建 `packages/host/terminal-web/` 包（`@deepseek-ai/dsh-host-terminal-web`）。
- 基础设施改动（支撑 `resize` 契约）：
  - `packages/subprocess/subprocess/src/types.ts`：`SubprocessTerminalHandle` 新增 `resize(cols, rows): Promise<void>`。
  - `packages/subprocess/subprocess-local/src/terminal.ts`：`LocalTerminalHandle.resize`（整数校验 ≥1、已退出抛错、转发 node-pty `terminal.resize`）。
  - `packages/e2b/subprocess-e2b/src/terminal.ts`：`resize` 确定性抛错（E2B API 无运行时 resize，失败要响不要静默）。
  - `packages/terminal/terminal-bash/tests/*.spec.ts`：测试夹具补 `resize: async () => {}`。
  - `packages/client/connection/src/index.ts`：重导出 `isTrustedApiRequest` / `rejectWebSocketUpgrade`（trust fence 供 host 复用）。
  - `tsconfig.host.json`：追加 `terminal-protocol` 与 `terminal-web` references。
- **不做**：不碰 `ctx.terminals`（owner-scoped 绑 Agent 的注册表，UI 直连不走它）、不引入新 PTY 依赖、不改 apps/web 构建。

## 关键设计

- **升级端点**：`WebSocketServer({ noServer: true })` + `ctx.webServer.registerUpgrade({ path: '/api/terminals', handler })`，仿 `websocket-downlink.ts` 模式。
- **Trust fence**：每个 upgrade 先过 `isTrustedApiRequest(req, config.trustedHosts)`，不通过直接 `rejectWebSocketUpgrade(socket)`（loopback 恒信任，`trustedHosts` 配置与 `client-connection` 同步）。
- **`TerminalSocket` 桥接**（`src/terminal-socket.ts`）：
  - `open` 帧到达 → `spawnTerminal(spec)`；`opening` 状态标志防重复 open（spawn 未完成时 handle 尚为 undefined，仅判 handle 会漏）。
  - pty `output` 流 → `Output` 帧 → WS；`done` → `Exit` 帧 + 关 socket。
  - WS `Input`/`Resize`/`Signal` → handle 的 `write`/`resize`/`signalForeground`。
  - 背压水位：`sentBytes` / `ackedBytes` / `paused`，客户端未 ack 超阈值时暂停向上游读取。
  - 清理：socket 断开/出错 → terminate handle；插件卸载 → `disposeUpgrade` + 遍历 `wss.clients` terminate + `wss.close()`。
- **Config**：`trustedHosts: string[]`（schemastery 不支持 readonly 数组，用可变类型）。
- **依赖**：deps `ws@^8.21.0` + `@types/ws`；peerDeps cordis / host-webserver / subprocess / terminal-protocol / schemastery。
- **类型合并**：空 `import type {}` 携带 webServer/subprocess 的 Context merge。

## 实施步骤

- [x] 基础设施改动（resize 契约 + connection 重导出 + tsconfig references）。
- [x] 新建包骨架（package.json / tsconfig.json / tsdown.config.ts，仿 directory-picker-native）。
- [x] `src/index.ts`：插件入口，`ctx.effect` 注册 upgrade + fence，返回 disposer。
- [x] `src/terminal-socket.ts`：帧桥接类（mock handle 的 vi.fn 必须返回 promise，否则 `.catch` 崩溃）。
- [x] `tests/terminal-socket.spec.ts`：open→output→exit 生命周期、输入转发、resize 转发、错误帧、清理路径。
- [x] `pnpm install`（补 schemastery 依赖）+ `tsc -b --force` + vitest 全绿。

## 验收标准

- [x] `pnpm run test` 全绿（159 + 8 新增）。
- [x] `pnpm run typecheck` 通过。
- [x] Node 脚本手测闭环：`open → output → input → exit`（shell 启动、有回显、exit 帧到达）。

## 已知坑（已踩）

- **vi.fn() 默认返回 undefined**：mock 的 handle 方法都要 `vi.fn(async () => {})`，否则 `await`/`.catch` 链路崩溃。
- **重复 open 检测**：仅判 handle 是否为 undefined 不够（spawn 进行中），需独立 `opening` 标志。
- **WebSocket 导入**：`import { WebSocket } from 'ws'` + 单独 `import type { RawData } from 'ws'`。
- **`signalNumber` 类型**：`NodeJS.Signals` 与协议表不匹配，用 `signal as SubprocessTerminalSignal` 关键字断言落到协议表。
