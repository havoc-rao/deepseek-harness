# 模块 01 — 共享协议包 `dsh-terminal-protocol`

**状态：✅ 已完成**

## 目标

定义浏览器端与 host 端共用的零依赖二进制帧协议，保证 WS 通道的帧契约只有一份事实来源，杜绝双端漂移。

## 范围

- 新建 `packages/util/terminal-protocol/` 包（`@deepseek-ai/dsh-terminal-protocol`）。
- 帧协议：opcode 枚举、编解码函数、spawn spec JSON 校验。
- 单元测试覆盖编解码边界。
- **不做**：WS 传输、PTY 逻辑、任何 Node/DOM 依赖。

## 关键契约

```ts
export const enum TerminalFrameOpcode {
  // client → server
  Open = 0x01,    // payload: UTF-8 JSON TerminalSpawnSpec
  Input = 0x02,   // payload: 原始输入字节
  Resize = 0x03,  // payload: 2×Uint16LE (cols, rows)
  Signal = 0x04,  // payload: 1×Uint8 信号编号
  Ack = 0x05,     // payload: 4×Uint32LE 已消费输出字节水位
  // server → client
  Output = 0x81,  // payload: pty 输出字节
  Exit = 0x82,    // payload: 1×Uint8 exitCode + 1×Uint8 signal(0=none)
  Error = 0x83,   // payload: UTF-8 错误消息
}
```

- `TERMINAL_SIGNAL_BYTES`：SIGHUP=1 / SIGINT=2 / SIGKILL=9 / SIGTERM=15 / SIGTSTP=20，镜像 `SubprocessTerminalSignal`。
- `TERMINAL_MAX_DIMENSION = 512`：cols/rows 上限，WS 边界校验用。
- `TerminalSpawnSpec`：`{ cwd?, env?, cols, rows, command? }`，cols/rows 必填且 1..=512，其余可选。
- 整数一律小端（`Uint16LE`/`Uint32LE`）。
- 使用 `TextEncoder`/`TextDecoder`，无 Node/DOM 全局依赖，可安全 inline 进浏览器 bundle。

## 实施步骤

- [x] `package.json`：零依赖，`"type": "module"`，license MIT，peerDeps 归零。
- [x] `src/index.ts`：全部编解码函数。
  - 帧装配：`buildFrame` / `readFrameOpcode` / `framePayload`。
  - open：`encodeSpawnSpec` / `parseSpawnSpec`（JSON 解析失败或字段类型/维度违反契约 → `undefined`；用中间 optional 对象收集可选字段再展开，避免 readonly 属性赋值）。
  - resize：`encodeResize` / `parseResize`（truncated 或越界 → `undefined`）。
  - signal：`encodeSignal` / `parseSignal`（先取 `payload[0]` 判 undefined 再查表，避免越界索引）。
  - ack：`encodeAck` / `parseAck`（truncated 读作 0）。
  - 服务端帧：`encodeOutputFrame` / `encodeExitFrame` / `encodeErrorFrame` / `decodeError`。
- [x] `tests/protocol.spec.ts`：编解码正反例、字节序断言（小端）、越界/截断/非法 JSON 边界。
- [x] 接入 `tsconfig.host.json` references。

## 验收标准

- [x] `pnpm run test` 新增用例全绿。
- [x] `pnpm run typecheck` 通过。
- [x] 帧协议枚举与 README 看板「跨模块契约」一致。

## 已知坑（已踩）

- **字节序**：`encodeResize` 是小端（cols 低 16 位在前），测试辅助 `bytes()` 是直观字节序，断言写错方向——统一按函数实际编码。
- **`parseSignal`**：`payload[0]` 在空 payload 时为 `undefined`，先判 undefined 再查 `NUMBER_TO_SIGNAL`。
- **readonly 属性赋值**：`parseSpawnSpec` 不能直接改 `TerminalSpawnSpec` 的可选字段，用中间对象收集后展开。
