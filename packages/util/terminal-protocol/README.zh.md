# @deepseek-ai/dsh-terminal-protocol

[English](README.md) | 中文

terminal-web host 桥接（[`dsh-host-terminal-web`](../../host/terminal-web/README.md)）与其浏览器 client（[`dsh-client-ui-terminal`](../../client/ui-terminal/README.md)）之间逐字共享的二进制帧协议。

一条 WebSocket 消息即一帧：一字节 opcode 后接 opcode 专属 payload。Client→server opcode（0x01–0x05）覆盖 Open、Input、Resize、Signal、Ack；server→client opcode（0x81–0x83）覆盖 Output、Exit、Error。整数一律小端；cols/rows 在 WS 边界校验为 1..=512 的整数（`TERMINAL_MAX_DIMENSION`）。该模块不依赖 DOM 或 Node，可内联到浏览器 bundle，无运行时依赖。

## Model Experience

None, as this package is a wire-protocol library that nothing here assembles or sends a provider request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **无压缩**——帧为原始字节；大输出传输付出全额带宽。可在不破坏协议的前提下添加逐帧压缩 opcode，但当前背压水位（512 KiB 暂停 / 256 KiB 恢复）已在无压缩下保持内存有界。
- **无会话恢复**——协议假设一个 socket 即一个 PTY 生命周期；没有用于恢复先前会话的帧。会话持久化是 `ctx.terminals` 为模型驱动会话承担的职责。
