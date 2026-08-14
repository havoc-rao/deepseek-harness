/**
 * TerminalSocket bridge tests: frame protocol driving, spawn-spec conversion,
 * output backpressure watermarks, and lifecycle cleanup.
 */

import { PassThrough } from 'node:stream'
import type { SubprocessOutcome, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  TerminalFrameOpcode,
  buildFrame,
  encodeAck,
  encodeResize,
  encodeSignal,
  encodeSpawnSpec,
  framePayload,
  readFrameOpcode,
} from '@deepseek-ai/dsh-terminal-protocol'
import type { WebSocket } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { TerminalSocket } from '../src/terminal-socket.ts'

/** Minimal WebSocket double exposing only what the bridge touches. */
class FakeWebSocket {
  static readonly OPEN = 1
  readyState = FakeWebSocket.OPEN
  readonly sent: Uint8Array[] = []
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): this {
    const bucket = this.listeners.get(event) ?? []
    bucket.push(listener)
    this.listeners.set(event, bucket)
    return this
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    return this.on(event, listener)
  }

  send(frame: Uint8Array): void {
    this.sent.push(frame)
  }

  close(): void {
    this.readyState = 3
  }

  emitMessage(payload: Uint8Array, binary = true): void {
    this.emit('message', payload, binary)
  }

  emitClose(): void {
    this.emit('close')
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

/** Deferred-exit pty double wired to the bridge's expectations. */
interface MockHandle {
  readonly handle: SubprocessTerminalHandle
  /** Mock vi.fn references for assertion without unbound-method noise. */
  readonly mocks: {
    readonly write: ReturnType<typeof vi.fn>
    readonly resize: ReturnType<typeof vi.fn>
    readonly inspectForeground: ReturnType<typeof vi.fn>
    readonly signalForeground: ReturnType<typeof vi.fn>
    readonly terminate: ReturnType<typeof vi.fn>
  }
  readonly output: PassThrough
  readonly exit: (outcome: SubprocessOutcome) => void
}

function mockHandle(): MockHandle {
  const output = new PassThrough()
  let resolveExit!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => { resolveExit = resolve })
  const write = vi.fn(async () => {})
  const resize = vi.fn(async () => {})
  const inspectForeground = vi.fn(async () => ({ processGroupId: 42, inputWaiting: false }))
  const signalForeground = vi.fn(async () => 42)
  const terminate = vi.fn(async () => {})
  return {
    handle: {
      pid: 42,
      output,
      done,
      write,
      resize,
      inspectForeground,
      signalForeground,
      terminate,
    },
    mocks: { write, resize, inspectForeground, signalForeground, terminate },
    output,
    exit: resolveExit,
  }
}

function spawnFor(handle: MockHandle): (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle> {
  return vi.fn(async (_spec: SubprocessTerminalSpawnSpec) => handle.handle)
}

function lastFrame(ws: FakeWebSocket): Uint8Array {
  const frame = ws.sent.at(-1)
  if (frame === undefined) throw new Error('no frame sent')
  return frame
}

function socketFor(
  ws: FakeWebSocket,
  spawn: (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>,
  log: (message: string) => void = () => {},
): TerminalSocket {
  return new TerminalSocket(ws as unknown as WebSocket, spawn, log)
}

const awaitFlush = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve) })

describe('TerminalSocket', () => {
  it('spawns on the open frame with a converted spec and forwards output', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    const spawn = spawnFor(handle)
    socketFor(ws, spawn)

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24, cwd: '/tmp' })))
    await awaitFlush()

    const spec = vi.mocked(spawn).mock.calls[0]![0]
    expect(spec.cols).toBe(80)
    expect(spec.rows).toBe(24)
    expect(spec.cwd).toBe('/tmp')
    expect(spec.graceMs).toBe(2000)
    expect(spec.env?.TERM).toBe('xterm-256color')
    // zsh shells launch with `+o prompt_sp` (see defaultShellArgv) so the
    // default argv grows the two flags; non-zsh shells stay bare.
    const shell = process.env.SHELL ?? '/bin/bash'
    const expectedArgv = shell.split('/').pop() === 'zsh' ? [shell, '+o', 'prompt_sp'] : [shell]
    expect(spec.argv).toEqual(expectedArgv)

    handle.output.write(Buffer.from('hello'))
    await awaitFlush()
    expect(readFrameOpcode(lastFrame(ws))).toBe(TerminalFrameOpcode.Output)
    expect(new TextDecoder().decode(framePayload(lastFrame(ws)))).toBe('hello')
  })

  it('honours an explicit command and overridden TERM', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    const spawn = spawnFor(handle)
    socketFor(ws, spawn)

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({
      cols: 100,
      rows: 40,
      command: ['zsh', '-l'],
      env: { TERM: 'tmux-256color' },
    })))
    await awaitFlush()

    const spec = vi.mocked(spawn).mock.calls[0]![0]
    expect(spec.argv).toEqual(['zsh', '-l'])
    expect(spec.env?.TERM).toBe('tmux-256color')
  })

  it('forwards input, resize, and signal frames to the handle', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    socketFor(ws, spawnFor(handle))

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    await awaitFlush()

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Input, new TextEncoder().encode('ls')))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Resize, encodeResize(120, 40)))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Signal, encodeSignal('SIGINT')))

    expect(handle.mocks.write).toHaveBeenCalledWith('ls')
    expect(handle.mocks.resize).toHaveBeenCalledWith(120, 40)
    expect(handle.mocks.signalForeground).toHaveBeenCalledWith('SIGINT')
  })

  it('queues input and resize arriving before spawn settles, then flushes them', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    let releaseSpawn!: (handle: SubprocessTerminalHandle) => void
    const spawn = vi.fn((_spec: SubprocessTerminalSpawnSpec) =>
      new Promise<SubprocessTerminalHandle>((resolve) => { releaseSpawn = resolve }))
    socketFor(ws, spawn)

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Input, new TextEncoder().encode('early')))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Resize, encodeResize(90, 30)))
    expect(handle.mocks.write).not.toHaveBeenCalled()

    releaseSpawn(handle.handle)
    await awaitFlush()

    expect(handle.mocks.write).toHaveBeenCalledWith('early')
    expect(handle.mocks.resize).toHaveBeenCalledWith(90, 30)
  })

  it('pauses output past the watermark and resumes after the client acks', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    socketFor(ws, spawnFor(handle))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    await awaitFlush()

    handle.output.write(Buffer.alloc(600 * 1024))
    await awaitFlush()
    expect(handle.output.isPaused()).toBe(true)

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Ack, encodeAck(600 * 1024)))
    expect(handle.output.isPaused()).toBe(false)
  })

  it('emits an exit frame and closes on terminal exit', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    socketFor(ws, spawnFor(handle))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    await awaitFlush()

    handle.exit({ exitCode: 0, signal: null })
    await awaitFlush()

    expect(readFrameOpcode(lastFrame(ws))).toBe(TerminalFrameOpcode.Exit)
    expect(framePayload(lastFrame(ws))).toEqual(Uint8Array.from([0, 0]))
    expect(ws.readyState).toBe(3)
  })

  it('terminates the pty when the socket closes without an exit', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    socketFor(ws, spawnFor(handle))
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    await awaitFlush()

    ws.emitClose()
    await awaitFlush()
    expect(handle.mocks.terminate).toHaveBeenCalled()
  })

  it('terminates a late-spawned pty when the socket died during spawn', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    let releaseSpawn!: (handle: SubprocessTerminalHandle) => void
    const spawn = vi.fn((_spec: SubprocessTerminalSpawnSpec) =>
      new Promise<SubprocessTerminalHandle>((resolve) => { releaseSpawn = resolve }))
    socketFor(ws, spawn)

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    ws.emitClose()
    releaseSpawn(handle.handle)
    await awaitFlush()
    expect(handle.mocks.terminate).toHaveBeenCalled()
  })

  it('rejects a duplicate open frame with an error frame', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    socketFor(ws, spawnFor(handle))
    const open = buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 }))

    ws.emitMessage(open)
    ws.emitMessage(open)
    await awaitFlush()

    expect(readFrameOpcode(lastFrame(ws))).toBe(TerminalFrameOpcode.Error)
    expect(ws.readyState).toBe(3)
  })

  it('rejects a malformed spawn spec with an error frame', async () => {
    const ws = new FakeWebSocket()
    socketFor(ws, vi.fn())

    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, new TextEncoder().encode('{"cols":0,"rows":0}')))
    await awaitFlush()

    expect(readFrameOpcode(lastFrame(ws))).toBe(TerminalFrameOpcode.Error)
    expect(ws.readyState).toBe(3)
  })

  it('drops text frames and unknown opcodes without closing', async () => {
    const ws = new FakeWebSocket()
    const handle = mockHandle()
    const logs: string[] = []
    socketFor(ws, spawnFor(handle), (message) => { logs.push(message) })
    ws.emitMessage(buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({ cols: 80, rows: 24 })))
    await awaitFlush()

    ws.emitMessage(new TextEncoder().encode('not binary'), false)
    ws.emitMessage(buildFrame(0x7f as TerminalFrameOpcode, new Uint8Array()))

    expect(handle.mocks.write).not.toHaveBeenCalled()
    expect(ws.readyState).not.toBe(3)
    expect(logs.some(line => line.includes('protocol violation'))).toBe(true)
  })
})
