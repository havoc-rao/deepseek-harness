/**
 * One WebSocket ↔ PTY bridge owned by the `terminal-web` host plugin.
 *
 * The socket's first frame must be an {@link TerminalFrameOpcode.Open} carrying
 * a validated spawn spec; the bridge then spawns the terminal through the
 * caller-provided spawn function and pumps pty output to the client while
 * feeding input, resize, and signal frames back to the handle. Output delivery
 * is gated by the client's {@link TerminalFrameOpcode.Ack} watermark so a
 * stalled renderer cannot pin unbounded memory in the host. Socket close and
 * terminal exit both end the pair; a close without exit terminates the pty as
 * a failsafe. The bridge logs connection lifecycle and spawn failures only —
 * never terminal content, which may carry secrets.
 */

import type { SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  TERMINAL_SIGNAL_BYTES,
  TerminalFrameOpcode,
  encodeErrorFrame,
  encodeExitFrame,
  encodeOutputFrame,
  framePayload,
  parseAck,
  parseResize,
  parseSignal,
  parseSpawnSpec,
  readFrameOpcode,
} from '@deepseek-ai/dsh-terminal-protocol'
import type { TerminalSpawnSpec } from '@deepseek-ai/dsh-terminal-protocol'
import { WebSocket } from 'ws'
import type { RawData } from 'ws'

/** Grace window (ms) between a signal frame and forced termination on exit. */
const TERMINAL_GRACE_MS = 2000
/** Outstanding unacked output that pauses the pty stream. */
const OUTPUT_PAUSE_WATERMARK = 512 * 1024
/** Outstanding unacked output that resumes the paused pty stream. */
const OUTPUT_RESUME_WATERMARK = 256 * 1024

/**
 * Bridge one client socket to one PTY.
 * @param ws - the upgraded WebSocket carrying terminal frames.
 * @param spawn - spawns the terminal handle for a validated spec.
 * @param log - connection-lifecycle and failure logging, never content.
 */
export class TerminalSocket {
  private handle: SubprocessTerminalHandle | undefined
  private readonly pendingInputs: string[] = []
  private pendingResize: { readonly cols: number; readonly rows: number } | undefined
  private opening = false
  private sentBytes = 0
  private ackedBytes = 0
  private paused = false
  private ended = false
  private disposed = false

  constructor(
    private readonly ws: WebSocket,
    private readonly spawn: (spec: SubprocessTerminalSpawnSpec) => Promise<SubprocessTerminalHandle>,
    private readonly log: (message: string) => void,
  ) {
    this.ws.on('message', (data, isBinary) => { this.onMessage(data, isBinary) })
    this.ws.once('close', () => { this.dispose('socket closed') })
    this.ws.once('error', (error) => {
      this.log(`terminal websocket error: ${String(error)}`)
      this.dispose('socket error')
    })
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (!isBinary) {
      this.log('terminal protocol violation: text frame dropped')
      return
    }
    const bytes = toBytes(data)
    const payload = framePayload(bytes)
    switch (readFrameOpcode(bytes)) {
      case TerminalFrameOpcode.Open:
        if (this.handle !== undefined || this.opening || this.ended) {
          this.fail('terminal protocol violation: duplicate open frame')
          return
        }
        this.opening = true
        this.handleOpen(payload)
        return
      case TerminalFrameOpcode.Input: {
        const text = textDecoder.decode(payload)
        if (this.handle === undefined) this.pendingInputs.push(text)
        else void this.handle.write(text).catch(() => {})
        return
      }
      case TerminalFrameOpcode.Resize: {
        const size = parseResize(payload)
        if (size === undefined) return
        if (this.handle === undefined) this.pendingResize = size
        else void this.handle.resize(size.cols, size.rows).catch(() => {})
        return
      }
      case TerminalFrameOpcode.Signal: {
        const signal = parseSignal(payload)
        if (signal === undefined || this.handle === undefined) return
        void this.handle.signalForeground(signal).catch(() => {})
        return
      }
      case TerminalFrameOpcode.Ack:
        this.handleAck(payload)
        return
      default:
        this.log('terminal protocol violation: unknown opcode dropped')
    }
  }

  private handleOpen(payload: Uint8Array): void {
    const spec = parseSpawnSpec(payload)
    if (spec === undefined) {
      this.fail('terminal spawn rejected: invalid open frame payload')
      return
    }
    void this.spawn(toSpawnSpec(spec)).then(
      (handle) => {
        if (this.disposed) {
          void handle.terminate().catch(() => {})
          return
        }
        this.bind(handle)
        this.flushPending()
      },
      (error: unknown) => { this.fail(`terminal spawn failed: ${String(error)}`) },
    )
  }

  private bind(handle: SubprocessTerminalHandle): void {
    this.handle = handle
    handle.output.on('data', (chunk: Buffer) => { this.sendOutput(chunk) })
    void handle.done.then(
      (outcome) => {
        this.ended = true
        this.send(encodeExitFrame(outcome.exitCode ?? 255, signalNumber(outcome.signal)))
        this.ws.close()
        this.dispose('terminal exited')
      },
      () => {
        // A rejected done is already surfaced by the spawn or terminate path.
        this.dispose('terminal failed')
      },
    )
  }

  private flushPending(): void {
    if (this.handle === undefined) return
    for (const input of this.pendingInputs) void this.handle.write(input).catch(() => {})
    this.pendingInputs.length = 0
    if (this.pendingResize !== undefined) {
      const { cols, rows } = this.pendingResize
      this.pendingResize = undefined
      void this.handle.resize(cols, rows).catch(() => {})
    }
  }

  private sendOutput(chunk: Buffer): void {
    if (this.ended) return
    this.sentBytes += chunk.byteLength
    this.send(encodeOutputFrame(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
    if (!this.paused && this.handle !== undefined && this.sentBytes - this.ackedBytes > OUTPUT_PAUSE_WATERMARK) {
      this.paused = true
      this.handle.output.pause()
    }
  }

  private handleAck(payload: Uint8Array): void {
    this.ackedBytes = Math.max(this.ackedBytes, parseAck(payload))
    if (this.paused && this.handle !== undefined && this.sentBytes - this.ackedBytes < OUTPUT_RESUME_WATERMARK) {
      this.paused = false
      this.handle.output.resume()
    }
  }

  private send(frame: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame)
  }

  private fail(message: string): void {
    this.log(message)
    this.ended = true
    this.send(encodeErrorFrame(message))
    this.ws.close()
    this.dispose('error')
  }

  private dispose(reason: string): void {
    if (this.disposed) return
    this.disposed = true
    this.log(`terminal bridge closed: ${reason}`)
    const handle = this.handle
    this.handle = undefined
    if (handle !== undefined) void handle.terminate().catch(() => {})
  }
}

function toSpawnSpec(spec: TerminalSpawnSpec): SubprocessTerminalSpawnSpec {
  const argv = spec.command !== undefined && spec.command.length > 0 ? [...spec.command] : defaultShellArgv()
  const env: Record<string, string> = { TERM: 'xterm-256color' }
  if (spec.env !== undefined) Object.assign(env, spec.env)
  return {
    argv,
    cwd: spec.cwd ?? process.cwd(),
    env,
    rows: spec.rows,
    cols: spec.cols,
    graceMs: TERMINAL_GRACE_MS,
  }
}

function defaultShellArgv(): string[] {
  const shell = process.env.SHELL
  if (shell !== undefined && shell.length > 0) {
    // zsh's PROMPT_SP (default on) rewrites the end-of-line marker after every
    // command under a pty, leaving a spurious `%` + blank line that reads as a
    // redundant newline. `+o prompt_sp` is applied before .zshrc runs, so a
    // user's explicit `setopt PROMPT_SP` in .zshrc still wins.
    if (shell.split('/').pop() === 'zsh') return [shell, '+o', 'prompt_sp']
    return [shell]
  }
  return process.platform === 'win32' ? ['powershell.exe'] : ['/bin/bash']
}

function signalNumber(signal: NodeJS.Signals | null): number {
  if (signal === null) return 0
  // Signals outside the protocol table (for example SIGABRT) degrade to "no
  // signal" on the wire; the terminal exited regardless, so no information is lost.
  const bytes = (TERMINAL_SIGNAL_BYTES as Readonly<Record<string, number | undefined>>)[signal]
  return bytes ?? 0
}

function toBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data)
}

const textDecoder = new TextDecoder()
