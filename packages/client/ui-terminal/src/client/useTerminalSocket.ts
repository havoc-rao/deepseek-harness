/** Browser-side WebSocket client for one terminal session. */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  TerminalFrameOpcode,
  buildFrame,
  decodeError,
  encodeAck,
  encodeResize,
  encodeSignal,
  encodeSpawnSpec,
  framePayload,
  readFrameOpcode,
} from '@deepseek-ai/dsh-terminal-protocol'

/** Connection phase surfaced to the terminal view. */
export type TerminalSocketPhase = 'connecting' | 'connected' | 'reconnecting' | 'closed'

/** WS upgrade path on the host webserver (mirror of the host upgrade route). */
const TERMINAL_UPGRADE_PATH = '/api/terminals'
/** Initial spawn geometry; the FitAddon + ResizeObserver corrects it after layout. */
const INITIAL_COLS = 80
const INITIAL_ROWS = 24
/** Reconnect backoff: 1s, 2s, 4s, 8s, then capped at 10s. */
const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 10_000
/**
 * Outstanding unacked output (bytes sent by the host minus bytes the terminal
 * consumed) that pauses further `term.write`. Mirrors the host bridge's
 * `OUTPUT_PAUSE_WATERMARK`; the pair must stay in step or one side backs up
 * while the other keeps sending.
 */
const OUTPUT_PAUSE_WATERMARK = 512 * 1024
/** Outstanding unacked output at which a paused client resumes writing. */
const OUTPUT_RESUME_WATERMARK = 256 * 1024

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Ship a protocol frame over the wire. Every frame we send is freshly
 * allocated by the protocol package (a real ArrayBuffer backer), while the
 * browser WebSocket types ask for `ArrayBufferView<ArrayBuffer>` — the
 * assertion only narrows the generic type parameter.
 */
function sendFrame(socket: WebSocket, frame: Uint8Array): void {
  socket.send(frame as Uint8Array<ArrayBuffer>)
}

/** Options for {@link useTerminalSocket}. */
export interface UseTerminalSocketOptions {
  /** Spawn argv; undefined lets the host pick its default shell. */
  readonly command?: readonly string[] | undefined
  /** Spawn working directory; undefined inherits the host process cwd. */
  readonly cwd?: string | undefined
  /**
   * pty output for the terminal. `onConsumed` must fire exactly once after the
   * data was handed to the terminal; it advances the ack watermark the host
   * uses to resume its paused output stream.
   */
  readonly onOutput: (data: string, onConsumed: () => void) => void
  /** The pty exited. */
  readonly onExit: (exitCode: number) => void
  /** The host rejected the session. */
  readonly onError: (message: string) => void
}

/** Terminal session handle returned by {@link useTerminalSocket}. */
export interface TerminalSocketHandle {
  /** Current connection phase. */
  readonly phase: TerminalSocketPhase
  /** Forward keyboard input to the pty. */
  readonly sendInput: (data: string) => void
  /** Push a size change to the pty. */
  readonly resize: (cols: number, rows: number) => void
}

/**
 * Owns one WebSocket per pty session: sends the spawn open frame on connect,
 * replays it on every reconnect, forwards input/resize frames, and asks the
 * host to terminate the pty before dropping the socket on unmount. A clean
 * pty exit (host Exit frame) ends the session without reconnecting; an
 * unexpected drop schedules an exponential-backoff reconnect.
 * @param options - session config and pty event callbacks.
 * @returns the session handle.
 */
export function useTerminalSocket(options: UseTerminalSocketOptions): TerminalSocketHandle {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const retryTimerRef = useRef<number | undefined>(undefined)
  const backoffRef = useRef(0)
  const exitedRef = useRef(false)
  const disposedRef = useRef(false)
  /** Bytes received from the host this session; the host's `sentBytes` mirror. */
  const receivedBytesRef = useRef(0)
  /** Bytes handed to the terminal this session; the ack watermark we report. */
  const consumedBytesRef = useRef(0)
  /** True while unacked output exceeds the pause watermark. */
  const pausedRef = useRef(false)
  /** Output buffered while paused; flushed once the ack watermark drops. */
  const pendingRef = useRef<Array<{ readonly text: string; readonly bytes: number }>>([])
  const [phase, setPhase] = useState<TerminalSocketPhase>('connecting')

  /**
   * Stable `handleFrame` reads the current flow-control closures through this
   * ref, so the message listener never goes stale across renders. The no-op
   * initializers are replaced on the first render.
   */
  const flowRef = useRef<{
    consumeOutput(socket: WebSocket, text: string, bytes: number): void
    resumeIfCaughtUp(socket: WebSocket): void
  }>({
    consumeOutput: () => {},
    resumeIfCaughtUp: () => {},
  })

  /**
   * Send the consumed-byte watermark upstream. The host raises its acked
   * watermark to the reported value (`Math.max`), so repeats are harmless.
   */
  const sendAck = useCallback((socket: WebSocket): void => {
    sendFrame(socket, buildFrame(TerminalFrameOpcode.Ack, encodeAck(consumedBytesRef.current)))
  }, [])

  /**
   * Hand one output chunk to the terminal and, once consumed, ack its bytes
   * and re-check the pause. The resume check runs on every write completion so
   * a paused stream cannot stall waiting for user input.
   */
  const consumeOutput = useCallback((socket: WebSocket, text: string, bytes: number): void => {
    optionsRef.current.onOutput(text, () => {
      consumedBytesRef.current += bytes
      sendAck(socket)
      flowRef.current.resumeIfCaughtUp(socket)
    })
  }, [sendAck])

  /**
   * Lift the pause once the terminal caught up with the stream and flush the
   * buffered output in arrival order.
   */
  const resumeIfCaughtUp = useCallback((socket: WebSocket): void => {
    if (!pausedRef.current) return
    if (receivedBytesRef.current - consumedBytesRef.current >= OUTPUT_RESUME_WATERMARK) return
    pausedRef.current = false
    const pending = pendingRef.current
    pendingRef.current = []
    for (const item of pending) consumeOutput(socket, item.text, item.bytes)
  }, [consumeOutput])

  flowRef.current = { consumeOutput, resumeIfCaughtUp }

  const sendSpawn = useCallback((socket: WebSocket): void => {
    const spec = optionsRef.current
    sendFrame(socket, buildFrame(TerminalFrameOpcode.Open, encodeSpawnSpec({
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      command: spec.command !== undefined ? [...spec.command] : undefined,
      cwd: spec.cwd,
      env: { TERM: 'xterm-256color' },
    })))
  }, [])

  const handleFrame = useCallback((frame: Uint8Array): void => {
    const opcode = readFrameOpcode(frame)
    const payload = framePayload(frame)
    switch (opcode) {
      case TerminalFrameOpcode.Output: {
        const bytes = payload.byteLength
        receivedBytesRef.current += bytes
        const socket = socketRef.current
        if (socket === undefined || socket.readyState !== WebSocket.OPEN) break
        if (receivedBytesRef.current - consumedBytesRef.current > OUTPUT_PAUSE_WATERMARK) {
          pausedRef.current = true
        }
        const text = utf8Decoder.decode(payload)
        if (pausedRef.current) {
          pendingRef.current.push({ text, bytes })
        } else {
          flowRef.current.consumeOutput(socket, text, bytes)
        }
        break
      }
      case TerminalFrameOpcode.Exit:
        exitedRef.current = true
        optionsRef.current.onExit(payload[0] ?? 0)
        break
      case TerminalFrameOpcode.Error:
        optionsRef.current.onError(decodeError(payload))
        break
      default:
        break
    }
  }, [])

  const connect = useCallback((): void => {
    // Retry timers are cleared on unmount, so connect cannot observe disposal.
    /* v8 ignore next -- disposed guard: unreachable, cleanup clears the retry timer first */
    if (disposedRef.current) return
    const url = new URL(TERMINAL_UPGRADE_PATH, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    socket.addEventListener('open', () => {
      backoffRef.current = 0
      // A reconnect is a fresh host session: byte counters restart from zero
      // and any output buffered for the old session is dropped.
      receivedBytesRef.current = 0
      consumedBytesRef.current = 0
      pausedRef.current = false
      pendingRef.current = []
      setPhase('connected')
      sendSpawn(socket)
    })
    socket.addEventListener('message', (event) => {
      // binaryType 'arraybuffer' keeps every frame as binary bytes; a text
      // message is not part of the terminal protocol and is ignored.
      if (typeof event.data !== 'string') handleFrame(new Uint8Array(event.data as ArrayBuffer))
    })
    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return
      socketRef.current = undefined
      if (disposedRef.current || exitedRef.current) {
        setPhase('closed')
        return
      }
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** backoffRef.current, MAX_BACKOFF_MS)
      backoffRef.current += 1
      setPhase('reconnecting')
      retryTimerRef.current = window.setTimeout(connect, delay)
    })
  }, [handleFrame, sendSpawn])

  useEffect(() => {
    disposedRef.current = false
    connect()
    return () => {
      disposedRef.current = true
      if (retryTimerRef.current !== undefined) window.clearTimeout(retryTimerRef.current)
      const socket = socketRef.current
      socketRef.current = undefined
      if (socket !== undefined && socket.readyState !== WebSocket.CLOSED) {
        // Ask the host to tear down the pty; the host's socket-close handler
        // terminates it too, so a fresh panel session always gets a fresh pty.
        if (socket.readyState === WebSocket.OPEN) {
          sendFrame(socket, buildFrame(TerminalFrameOpcode.Signal, encodeSignal('SIGTERM')))
        }
        socket.close()
      }
    }
  }, [connect])

  const sendInput = useCallback((data: string): void => {
    const socket = socketRef.current
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      sendFrame(socket, buildFrame(TerminalFrameOpcode.Input, utf8Encoder.encode(data)))
      // User keystrokes are a liveness probe: resume a paused stream if the
      // terminal has already caught up.
      flowRef.current.resumeIfCaughtUp(socket)
    }
  }, [])

  const resize = useCallback((cols: number, rows: number): void => {
    const socket = socketRef.current
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      sendFrame(socket, buildFrame(TerminalFrameOpcode.Resize, encodeResize(cols, rows)))
    }
  }, [])

  return { phase, sendInput, resize }
}
