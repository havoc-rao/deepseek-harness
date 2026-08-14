# @deepseek-ai/dsh-terminal-protocol

English | [中文](README.zh.md)

terminal-web host 桥接（[`dsh-host-terminal-web`](../../host/terminal-web/README.md)）与其浏览器 client（[`dsh-client-ui-terminal`](../../client/ui-terminal/README.md)）之间逐字共享的二进制帧协议。

One WebSocket message is exactly one frame: a one-byte opcode followed by an opcode-specific payload. Client→server opcodes (0x01–0x05) cover Open, Input, Resize, Signal, and Ack; server→client opcodes (0x81–0x83) cover Output, Exit, and Error. Integers are little-endian; cols/rows are validated at the WS boundary as integers in 1..=512 (`TERMINAL_MAX_DIMENSION`). The module is DOM- and Node-agnostic so it inlines into the browser bundle with no runtime dependencies.

## Model Experience

None, as this package is a wire-protocol library that nothing here assembles or sends a provider request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No compression** — frames are raw bytes; large output transfers pay full bandwidth. A per-frame compression opcode could be added without breaking the protocol, but the current backpressure watermarks (512 KiB pause / 256 KiB resume) keep memory bounded without it.
- **No session resumption** — the protocol assumes one socket is one PTY lifetime; there is no frame for resuming a previous session. Session persistence is the job of `ctx.terminals` for model-driven sessions.
