/**
 * Binary frame protocol shared verbatim between the terminal-web host bridge
 * (dsh-host-terminal-web) and its browser client (dsh-client-ui-terminal).
 *
 * One WebSocket message is exactly one frame: a one-byte opcode followed by
 * an opcode-specific payload. One socket is one PTY lifetime — the client
 * reconnects and re-opens a fresh shell after a drop, never resuming a dead
 * session. Bytes are transferred as UTF-8 (Input/Output) or as raw little-
 * endian integers; nothing here depends on Node or DOM globals so the module
 * is safe to inline into the browser bundle.
 */

/** One-byte frame opcodes. Client→server 0x01–0x05, server→client 0x81–0x83. */
export enum TerminalFrameOpcode {
  /** Payload: UTF-8 JSON {@link TerminalSpawnSpec}. */
  Open = 0x01,
  /** Payload: raw UTF-8 terminal input bytes. */
  Input = 0x02,
  /** Payload: 2×Uint16LE (cols, rows). */
  Resize = 0x03,
  /** Payload: 1×Uint8 control-signal number (see {@link TERMINAL_SIGNAL_BYTES}). */
  Signal = 0x04,
  /** Payload: 4×Uint32LE consumed-output byte watermark (backpressure ack). */
  Ack = 0x05,
  /** Server→client; payload: raw UTF-8 terminal output bytes. */
  Output = 0x81,
  /** Server→client; payload: 1×Uint8 exit code + 1×Uint8 signal (0 = none). */
  Exit = 0x82,
  /** Server→client; payload: UTF-8 error message. */
  Error = 0x83,
}

/** Control-signal numbers carried by a Signal frame, mirrored to `SubprocessTerminalSignal`. */
export const TERMINAL_SIGNAL_BYTES: Readonly<Record<TerminalSignalName, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGKILL: 9,
  SIGTERM: 15,
  SIGTSTP: 20,
}

/** Signal names understood by the terminal bridge. */
export type TerminalSignalName = 'SIGHUP' | 'SIGINT' | 'SIGKILL' | 'SIGTERM' | 'SIGTSTP'

/** Inclusive upper bound for terminal cols/rows, validated at the WS boundary. */
export const TERMINAL_MAX_DIMENSION = 512

/** Client→server spawn request carried by an Open frame. */
export interface TerminalSpawnSpec {
  /** Working directory; defaults to the host process cwd when absent. */
  readonly cwd?: string | undefined
  /** Explicit environment layered after the provider's ambient scrub. */
  readonly env?: Readonly<Record<string, string>> | undefined
  /** Initial terminal column count, 1..=TERMINAL_MAX_DIMENSION. */
  readonly cols: number
  /** Initial terminal row count, 1..=TERMINAL_MAX_DIMENSION. */
  readonly rows: number
  /** Shell command; defaults to the host platform shell when absent. */
  readonly command?: readonly string[] | undefined
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Build a frame from an opcode and optional payload bytes. */
export function buildFrame(opcode: TerminalFrameOpcode, payload?: Uint8Array): Uint8Array {
  if (payload === undefined || payload.byteLength === 0) return new Uint8Array([opcode])
  const frame = new Uint8Array(1 + payload.byteLength)
  frame[0] = opcode
  frame.set(payload, 1)
  return frame
}

/** Read the opcode byte of a frame, or undefined for an empty message. */
export function readFrameOpcode(frame: Uint8Array): TerminalFrameOpcode | undefined {
  if (frame.byteLength === 0) return undefined
  return frame[0] as TerminalFrameOpcode
}

/** Payload bytes of a frame (everything after the opcode byte). */
export function framePayload(frame: Uint8Array): Uint8Array {
  return frame.subarray(1)
}

/** Encode a spawn spec as an Open frame payload (UTF-8 JSON). */
export function encodeSpawnSpec(spec: TerminalSpawnSpec): Uint8Array {
  return textEncoder.encode(JSON.stringify(spec))
}

/**
 * Decode and validate a spawn spec from an Open frame payload.
 * @returns the spec, or undefined when the payload is not valid JSON or a
 * dimension/field type violates the contract.
 */
export function parseSpawnSpec(payload: Uint8Array): TerminalSpawnSpec | undefined {
  let value: unknown
  try {
    value = JSON.parse(textDecoder.decode(payload))
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (!isDimension(record.cols) || !isDimension(record.rows)) return undefined
  const optional: {
    cwd?: string
    command?: readonly string[]
    env?: Readonly<Record<string, string>>
  } = {}
  if (record.cwd !== undefined) {
    if (typeof record.cwd !== 'string') return undefined
    optional.cwd = record.cwd
  }
  if (record.command !== undefined) {
    if (!Array.isArray(record.command) || record.command.some(part => typeof part !== 'string')) return undefined
    optional.command = record.command
  }
  if (record.env !== undefined) {
    if (typeof record.env !== 'object' || record.env === null || Array.isArray(record.env)) return undefined
    const env: Record<string, string> = {}
    for (const [key, raw] of Object.entries(record.env)) {
      if (typeof raw !== 'string') return undefined
      env[key] = raw
    }
    optional.env = env
  }
  return { cols: record.cols, rows: record.rows, ...optional }
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= TERMINAL_MAX_DIMENSION
}

/** Encode a resize payload (2×Uint16LE cols, rows). */
export function encodeResize(cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(4)
  const view = new DataView(out.buffer)
  view.setUint16(0, cols, true)
  view.setUint16(2, rows, true)
  return out
}

/**
 * Decode a resize payload.
 * @returns cols/rows, or undefined when the payload is truncated or out of range.
 */
export function parseResize(payload: Uint8Array): { readonly cols: number; readonly rows: number } | undefined {
  if (payload.byteLength < 4) return undefined
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const cols = view.getUint16(0, true)
  const rows = view.getUint16(2, true)
  if (!isDimension(cols) || !isDimension(rows)) return undefined
  return { cols, rows }
}

const NUMBER_TO_SIGNAL: ReadonlyMap<number, TerminalSignalName> = new Map(
  Object.entries(TERMINAL_SIGNAL_BYTES).map(([name, number]) => [number, name as TerminalSignalName]),
)

/** Encode a control-signal payload (1×Uint8). */
export function encodeSignal(signal: TerminalSignalName): Uint8Array {
  return new Uint8Array([TERMINAL_SIGNAL_BYTES[signal]])
}

/** Decode a control-signal payload, or undefined for an unknown byte. */
export function parseSignal(payload: Uint8Array): TerminalSignalName | undefined {
  if (payload.byteLength < 1) return undefined
  const byte = payload[0]
  /* v8 ignore next -- payload.byteLength is guarded above, so payload[0] is always defined */
  return byte === undefined ? undefined : NUMBER_TO_SIGNAL.get(byte)
}

/** Encode a consumed-byte watermark ack (4×Uint32LE). */
export function encodeAck(consumedBytes: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, consumedBytes >>> 0, true)
  return out
}

/** Decode a consumed-byte watermark ack; truncated payloads read as 0. */
export function parseAck(payload: Uint8Array): number {
  if (payload.byteLength < 4) return 0
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true)
}

/** Build an Output frame carrying raw pty output bytes. */
export function encodeOutputFrame(payload: Uint8Array): Uint8Array {
  return buildFrame(TerminalFrameOpcode.Output, payload)
}

/** Build an Exit frame (exit code + signal number, 0 = none). */
export function encodeExitFrame(exitCode: number, signal: number): Uint8Array {
  const out = new Uint8Array(3)
  out[0] = TerminalFrameOpcode.Exit
  out[1] = exitCode & 0xff
  out[2] = signal & 0xff
  return out
}

/** Build an Error frame carrying a UTF-8 message. */
export function encodeErrorFrame(message: string): Uint8Array {
  return buildFrame(TerminalFrameOpcode.Error, textEncoder.encode(message))
}

/** Decode an Error frame payload into text. */
export function decodeError(payload: Uint8Array): string {
  return textDecoder.decode(payload)
}
