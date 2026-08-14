// @vitest-environment jsdom
// Flow control on the client side of the terminal protocol: the socket hook
// writes pty output through `onOutput`, acks consumed bytes upstream, pauses
// once unacked output exceeds the watermark, and resumes (flushing the buffered
// backlog) once the terminal catches up.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalFrameOpcode,
  buildFrame,
  framePayload,
  parseAck,
  readFrameOpcode,
} from '@deepseek-ai/dsh-terminal-protocol'
import { useTerminalSocket, type UseTerminalSocketOptions } from '../src/client/useTerminalSocket.ts'

/** Browser WebSocket double driving the hook under test. */
class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static readonly instances: FakeWebSocket[] = []
  readonly url: string
  readonly sent: Uint8Array[] = []
  binaryType = 'blob'
  readyState = FakeWebSocket.OPEN
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? []
    bucket.push(listener)
    this.listeners.set(type, bucket)
  }

  send(frame: Uint8Array): void {
    this.sent.push(frame)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
  }

  emitOpen(): void {
    for (const listener of this.listeners.get('open') ?? []) listener()
  }

  emitMessage(data: Uint8Array): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }

  emitClose(): void {
    for (const listener of this.listeners.get('close') ?? []) listener()
  }
}

/** 64 KiB ASCII chunk; nine chunks exceed the 512 KiB pause watermark. */
const CHUNK = new Uint8Array(64 * 1024).fill(0x61)
const CHUNK_BYTES = CHUNK.byteLength

function outputFrame(): Uint8Array {
  return buildFrame(TerminalFrameOpcode.Output, CHUNK)
}

function sentFrames(socket: FakeWebSocket, opcode: TerminalFrameOpcode): Uint8Array[] {
  return socket.sent.filter(frame => readFrameOpcode(frame) === opcode)
}

interface OutputCapture {
  readonly texts: string[]
  readonly consumes: Array<() => void>
  readonly onOutput: (data: string, onConsumed: () => void) => void
}

function makeOutput(): OutputCapture {
  const capture = {
    texts: [] as string[],
    consumes: [] as Array<() => void>,
    onOutput(data: string, onConsumed: () => void): void {
      capture.texts.push(data)
      capture.consumes.push(onConsumed)
    },
  }
  return capture
}

/** Socket options with no-op exit/error handlers; flow-control specs only exercise output. */
function makeSocketOptions(onOutput: (data: string, onConsumed: () => void) => void): UseTerminalSocketOptions {
  return { onOutput, onExit: () => {}, onError: () => {} }
}

describe('useTerminalSocket flow control', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    FakeWebSocket.instances.length = 0
  })

  it('writes pty output through onOutput and acks consumed bytes', () => {
    const capture = makeOutput()
    const { unmount } = renderHook(() => useTerminalSocket(makeSocketOptions(capture.onOutput)))
    const socket = FakeWebSocket.instances[0]!
    act(() => { socket.emitOpen() })
    act(() => { socket.emitMessage(buildFrame(TerminalFrameOpcode.Output, new TextEncoder().encode('hello'))) })
    expect(capture.texts).toEqual(['hello'])

    act(() => { capture.consumes[0]!() })
    const acks = sentFrames(socket, TerminalFrameOpcode.Ack)
    expect(acks).toHaveLength(1)
    expect(parseAck(framePayload(acks[0]!))).toBe(5)
    unmount()
  })

  it('pauses writes beyond the watermark and resumes after the terminal catches up', () => {
    const capture = makeOutput()
    const { unmount } = renderHook(() => useTerminalSocket(makeSocketOptions(capture.onOutput)))
    const socket = FakeWebSocket.instances[0]!
    act(() => { socket.emitOpen() })

    // Eight chunks reach the exact watermark (524 288 bytes) and still write.
    for (let i = 0; i < 8; i += 1) act(() => { socket.emitMessage(outputFrame()) })
    expect(capture.texts).toHaveLength(8)

    // The ninth chunk crosses the watermark: it is buffered, not written.
    act(() => { socket.emitMessage(outputFrame()) })
    expect(capture.texts).toHaveLength(8)

    // Consuming the first eight chunks drops unacked output to 64 KiB, below
    // the resume watermark: the ninth chunk flushes to the terminal.
    for (let i = 0; i < 8; i += 1) act(() => { capture.consumes[i]!() })
    expect(capture.texts).toHaveLength(9)

    // Consuming the flushed ninth chunk acks the full nine-chunk stream.
    act(() => { capture.consumes[8]!() })
    const acks = sentFrames(socket, TerminalFrameOpcode.Ack)
    expect(parseAck(framePayload(acks[acks.length - 1]!))).toBe(9 * CHUNK_BYTES)
    unmount()
  })

  it('forwards keystrokes as input frames', () => {
    const { result, unmount } = renderHook(() => useTerminalSocket(makeSocketOptions(() => {})))
    const socket = FakeWebSocket.instances[0]!
    act(() => { socket.emitOpen() })
    act(() => { result.current.sendInput('ls') })
    const inputs = sentFrames(socket, TerminalFrameOpcode.Input)
    expect(inputs).toHaveLength(1)
    expect(new TextDecoder().decode(framePayload(inputs[0]!))).toBe('ls')
    unmount()
  })

  it('restarts byte counters on reconnect so the ack watermark starts fresh', () => {
    const capture = makeOutput()
    const { unmount } = renderHook(() => useTerminalSocket(makeSocketOptions(capture.onOutput)))
    const first = FakeWebSocket.instances[0]!
    act(() => { first.emitOpen() })
    act(() => { first.emitMessage(buildFrame(TerminalFrameOpcode.Output, new TextEncoder().encode('a'))) })
    act(() => { capture.consumes[0]!() })
    expect(parseAck(framePayload(sentFrames(first, TerminalFrameOpcode.Ack)[0]!))).toBe(1)

    act(() => { first.emitClose() })
    act(() => { vi.advanceTimersByTime(1_000) })
    const second = FakeWebSocket.instances[1]!
    expect(second).not.toBeUndefined()
    act(() => { second.emitOpen() })
    act(() => { second.emitMessage(buildFrame(TerminalFrameOpcode.Output, new TextEncoder().encode('bb'))) })
    act(() => { capture.consumes[1]!() })
    const acks = sentFrames(second, TerminalFrameOpcode.Ack)
    expect(parseAck(framePayload(acks[acks.length - 1]!))).toBe(2)
    unmount()
  })
})
