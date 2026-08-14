// @vitest-environment jsdom
// TerminalView assembly: the FitAddon layout hook loads onto the terminal and
// reports a fitted geometry as a resize frame, output scrolls the view only
// while pinned to the bottom (an up-scroll yields control), keystrokes flow
// upstream as input frames, and a debounced container resize refits.

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalFrameOpcode,
  buildFrame,
  framePayload,
  parseResize,
  readFrameOpcode,
} from '@deepseek-ai/dsh-terminal-protocol'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
// Type-only import triggers the `terminal` LocaleNamespaceMap merge declared
// by the client entry, so PropsLocale<'terminal'> resolves instead of `object`.
import type {} from '../src/client/index.ts'
import { TerminalView } from '../src/client/TerminalView.tsx'

/** Browser WebSocket double (mirrors flow-control.spec; specs stay self-contained). */
class FakeWebSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static readonly instances: FakeWebSocket[] = []
  readonly sent: Uint8Array[] = []
  binaryType = 'blob'
  readyState = FakeWebSocket.OPEN
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor() {
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
}

/** xterm double with the private scrollToBottom slot the view patches. */
const { FakeTerminal, fakeTerminals, scrollToBottomMocks } = vi.hoisted(() => {
  const fakeTerminals: FakeTerminal[] = []
  /** Original `_core.scrollToBottom` mocks; the view replaces the slot with a
   *  patched wrapper, so tests assert the underlying mock's call count. */
  const scrollToBottomMocks: ReturnType<typeof vi.fn>[] = []
  class FakeTerminal {
    cols = 80
    rows = 24
    /** 100-line scrollback pinned to the bottom: both the viewport top and the
     *  bottom page sit at line 76 (`length - rows`). An up-scroll moves only
     *  `viewportY`; `baseY` (the cursor line) stays put for a running shell. */
    readonly buffer = { active: { baseY: 76, viewportY: 76, length: 100 } }
    readonly loadAddon = vi.fn((addon: { activate(terminal: unknown): void }) => {
      addon.activate(this)
    })
    readonly write = vi.fn()
    readonly dispose = vi.fn()
    readonly open = vi.fn()
    readonly onScroll = vi.fn<(handler: () => void) => { dispose(): void }>(() => ({
      dispose: vi.fn(),
    }))
    readonly onData = vi.fn<(handler: (data: string) => void) => { dispose(): void }>(() => ({
      dispose: vi.fn(),
    }))
    readonly onWrite = vi.fn(() => ({ dispose: vi.fn() }))
    readonly _core = { scrollToBottom: vi.fn() }

    constructor() {
      fakeTerminals.push(this)
      scrollToBottomMocks.push(this._core.scrollToBottom)
    }
  }
  return { FakeTerminal, fakeTerminals, scrollToBottomMocks }
})

/** FitAddon double whose fit() applies the preset geometry. */
const { FakeFitAddon } = vi.hoisted(() => {
  class FakeFitAddon {
    static nextSize: { readonly cols: number; readonly rows: number } | undefined
    readonly fit = vi.fn(() => {
      const terminal = this.terminal as { cols: number; rows: number } | undefined
      const size = FakeFitAddon.nextSize
      if (terminal !== undefined && size !== undefined) {
        terminal.cols = size.cols
        terminal.rows = size.rows
      }
    })
    readonly dispose = vi.fn()
    private terminal: unknown
    activate(terminal: unknown): void {
      this.terminal = terminal
    }
  }
  return { FakeFitAddon }
})

/** ResizeObserver double recording its callback for manual firing. */
const { FakeResizeObserver, resizeCallbacks } = vi.hoisted(() => {
  const resizeCallbacks: Array<() => void> = []
  class FakeResizeObserver {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback)
    }
    observe(): void {}
    disconnect(): void {}
  }
  return { FakeResizeObserver, resizeCallbacks }
})

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const OUTPUT = buildFrame(TerminalFrameOpcode.Output, new TextEncoder().encode('pwd'))

function resizeFrames(socket: FakeWebSocket): Array<{ cols: number; rows: number }> {
  return socket.sent
    .filter(frame => readFrameOpcode(frame) === TerminalFrameOpcode.Resize)
    .map(frame => parseResize(framePayload(frame)))
    .map(size => size ?? { cols: -1, rows: -1 })
}

describe('TerminalView assembly', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    FakeWebSocket.instances.length = 0
    fakeTerminals.length = 0
    scrollToBottomMocks.length = 0
    resizeCallbacks.length = 0
    FakeFitAddon.nextSize = undefined
  })

  it('loads the FitAddon and reports the fitted geometry as a resize frame', () => {
    FakeFitAddon.nextSize = { cols: 120, rows: 30 }
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    expect(terminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(terminal.open).toHaveBeenCalledTimes(1)
    const socket = FakeWebSocket.instances[0]!
    expect(resizeFrames(socket)).toEqual([{ cols: 120, rows: 30 }])
  })

  it('keeps the view pinned to the bottom for output and yields on up-scroll', () => {
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    const socket = FakeWebSocket.instances[0]!
    const container = terminal.open.mock.calls[0]![0] as HTMLElement
    const wheel = (deltaY: number) => {
      act(() => {
        container.dispatchEvent(new WheelEvent('wheel', { deltaY }))
        // Run the re-pin check scheduled for the next animation frame.
        vi.runOnlyPendingTimers()
      })
    }

    // Pinned by default: output scrolls the view (core scrollToBottom fires).
    act(() => socket.emitMessage(OUTPUT))
    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(scrollToBottomMocks[0]).toHaveBeenCalledTimes(1)

    // Up-scroll unpins the view: the viewport top moves up while the cursor
    // line (baseY) stays at the bottom, exactly as a running shell behaves,
    // and the re-pin check confirms the viewport is no longer at the bottom.
    terminal.buffer.active.viewportY = 50
    wheel(-100)
    act(() => socket.emitMessage(OUTPUT))
    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(scrollToBottomMocks[0]).toHaveBeenCalledTimes(1)

    // Scrolling back to the bottom re-pins: output scrolls again.
    terminal.buffer.active.viewportY = 76
    wheel(100)
    act(() => socket.emitMessage(OUTPUT))
    expect(terminal.write).toHaveBeenCalledTimes(3)
    expect(scrollToBottomMocks[0]).toHaveBeenCalledTimes(2)
  })

  it('forwards keystrokes upstream as input frames', () => {
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    const socket = FakeWebSocket.instances[0]!
    const onData = terminal.onData.mock.calls[0]![0] as (data: string) => void
    act(() => onData('echo hi'))
    const inputs = socket.sent.filter(frame => readFrameOpcode(frame) === TerminalFrameOpcode.Input)
    expect(inputs).toHaveLength(1)
    expect(new TextDecoder().decode(framePayload(inputs[0]!))).toBe('echo hi')
  })

  it('refits after a debounced container resize and dedupes unchanged sizes', () => {
    FakeFitAddon.nextSize = { cols: 120, rows: 30 }
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const socket = FakeWebSocket.instances[0]!

    FakeFitAddon.nextSize = { cols: 100, rows: 20 }
    act(() => {
      resizeCallbacks[0]!()
      vi.advanceTimersByTime(32)
    })
    expect(resizeFrames(socket)).toEqual([
      { cols: 120, rows: 30 },
      { cols: 100, rows: 20 },
    ])

    // Same geometry again: the fit runs but reports nothing.
    act(() => {
      resizeCallbacks[0]!()
      vi.advanceTimersByTime(32)
    })
    expect(resizeFrames(socket)).toHaveLength(2)
  })
})
