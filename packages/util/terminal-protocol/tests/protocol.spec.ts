import { describe, expect, it } from 'vitest'
import {
  TERMINAL_MAX_DIMENSION,
  TerminalFrameOpcode,
  buildFrame,
  decodeError,
  encodeAck,
  encodeErrorFrame,
  encodeExitFrame,
  encodeOutputFrame,
  encodeResize,
  encodeSignal,
  encodeSpawnSpec,
  framePayload,
  parseAck,
  parseResize,
  parseSignal,
  parseSpawnSpec,
  readFrameOpcode,
} from '@deepseek-ai/dsh-terminal-protocol'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

describe('frame assembly', () => {
  it('builds an opcode-only frame for an empty payload', () => {
    expect(buildFrame(TerminalFrameOpcode.Input)).toEqual(bytes(TerminalFrameOpcode.Input))
    expect(buildFrame(TerminalFrameOpcode.Input, new Uint8Array(0))).toEqual(bytes(TerminalFrameOpcode.Input))
  })

  it('prefixes the payload with the opcode byte', () => {
    const frame = buildFrame(TerminalFrameOpcode.Input, bytes(0x61, 0x62))
    expect(frame).toEqual(bytes(TerminalFrameOpcode.Input, 0x61, 0x62))
  })

  it('round-trips opcode and payload', () => {
    const frame = buildFrame(TerminalFrameOpcode.Output, bytes(1, 2, 3))
    expect(readFrameOpcode(frame)).toBe(TerminalFrameOpcode.Output)
    expect(framePayload(frame)).toEqual(bytes(1, 2, 3))
  })

  it('rejects an empty message opcode', () => {
    expect(readFrameOpcode(new Uint8Array(0))).toBeUndefined()
  })
})

describe('spawn spec', () => {
  it('encodes and parses a full spec', () => {
    const spec = { cols: 120, rows: 30, cwd: '/tmp', command: ['bash', '-l'], env: { TERM: 'xterm-256color' } }
    const parsed = parseSpawnSpec(framePayload(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec(spec))))
    expect(parsed).toEqual(spec)
  })

  it('parses a minimal spec', () => {
    const parsed = parseSpawnSpec(encodeSpawnSpec({ cols: 80, rows: 24 }))
    expect(parsed).toEqual({ cols: 80, rows: 24 })
  })

  it('rejects invalid JSON', () => {
    expect(parseSpawnSpec(bytes(0x7b, 0x7b))).toBeUndefined()
  })

  it('rejects non-object JSON', () => {
    expect(parseSpawnSpec(bytes(0x6e, 0x75, 0x6c, 0x6c))).toBeUndefined() // "null"
    expect(parseSpawnSpec(bytes(0x31, 0x32))).toBeUndefined() // "12"
  })

  it.each([
    [{ cols: 0, rows: 24 }],
    [{ cols: 80, rows: -1 }],
    [{ cols: 1.5, rows: 24 }],
    [{ cols: '80', rows: 24 }],
    [{ cols: TERMINAL_MAX_DIMENSION + 1, rows: 24 }],
  ])('rejects out-of-range dimensions %j', (bad) => {
    expect(parseSpawnSpec(encodeSpawnSpec(bad as never))).toBeUndefined()
  })

  it('rejects malformed command and env', () => {
    expect(parseSpawnSpec(encodeSpawnSpec({ cols: 80, rows: 24, command: ['ok', 1] as never }))).toBeUndefined()
    expect(parseSpawnSpec(encodeSpawnSpec({ cols: 80, rows: 24, env: { A: 1 } as never }))).toBeUndefined()
  })
})

describe('resize', () => {
  it('round-trips cols/rows', () => {
    const payload = encodeResize(100, 40)
    expect(payload).toEqual(bytes(100, 0, 40, 0))
    expect(parseResize(payload)).toEqual({ cols: 100, rows: 40 })
  })

  it('rejects truncated payloads', () => {
    expect(parseResize(bytes(100, 40))).toBeUndefined()
  })

  it('rejects out-of-range dimensions', () => {
    expect(parseResize(encodeResize(0, 24))).toBeUndefined()
    expect(parseResize(encodeResize(80, TERMINAL_MAX_DIMENSION + 1))).toBeUndefined()
  })
})

describe('signal', () => {
  it('round-trips each supported signal', () => {
    for (const [name, number] of Object.entries({ SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15, SIGTSTP: 20 })) {
      expect(parseSignal(encodeSignal(name as never))).toBe(name)
      expect(encodeSignal(name as never)[0]).toBe(number)
    }
  })

  it('rejects unknown and truncated payloads', () => {
    expect(parseSignal(bytes(0x07))).toBeUndefined()
    expect(parseSignal(new Uint8Array(0))).toBeUndefined()
  })
})

describe('ack', () => {
  it('round-trips a consumed-byte watermark', () => {
    expect(parseAck(encodeAck(131072))).toBe(131072)
    expect(encodeAck(131072)).toEqual(bytes(0, 0, 2, 0))
  })

  it('reads truncated payloads as zero', () => {
    expect(parseAck(bytes(1))).toBe(0)
  })
})

describe('server frames', () => {
  it('builds an output frame with raw bytes', () => {
    const frame = encodeOutputFrame(bytes(0x1b, 0x5b, 0x33, 0x31))
    expect(readFrameOpcode(frame)).toBe(TerminalFrameOpcode.Output)
    expect(framePayload(frame)).toEqual(bytes(0x1b, 0x5b, 0x33, 0x31))
  })

  it('builds an exit frame with code and signal', () => {
    expect(encodeExitFrame(0, 0)).toEqual(bytes(TerminalFrameOpcode.Exit, 0, 0))
    expect(encodeExitFrame(130, 2)).toEqual(bytes(TerminalFrameOpcode.Exit, 130, 2))
  })

  it('round-trips error frames', () => {
    const frame = encodeErrorFrame('spawn failed: no such file')
    expect(readFrameOpcode(frame)).toBe(TerminalFrameOpcode.Error)
    expect(decodeError(framePayload(frame))).toBe('spawn failed: no such file')
  })
})
