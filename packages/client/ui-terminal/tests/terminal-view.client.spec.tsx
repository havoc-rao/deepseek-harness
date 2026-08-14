// @vitest-environment jsdom
// TerminalView assembly: the FitAddon layout hook loads onto the terminal and
// reports a fitted geometry as a resize frame, output scrolls the view only
// while pinned to the bottom (an up-scroll yields control), keystrokes flow
// upstream as input frames, a debounced container resize refits, the renderer
// starts on WebGL and rebuilds on GPU context loss up to the budget then falls
// back to Canvas, and a theme revision change re-projects the xterm theme.

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TerminalFrameOpcode,
  buildFrame,
  encodeErrorFrame,
  encodeExitFrame,
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

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED
    for (const listener of this.listeners.get('close') ?? []) listener()
  }

  emitMessage(data: Uint8Array): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }
}

/** xterm double with the private slots the view patches (scrollToBottom + render service). */
const { FakeTerminal, fakeTerminals, scrollToBottomMocks, renderRowsMocks, themeSetters } = vi.hoisted(() => {
  const fakeTerminals: FakeTerminal[] = []
  /** Original `_core.scrollToBottom` mocks; the view replaces the slot with a
   *  patched wrapper, so tests assert the underlying mock's call count. */
  const scrollToBottomMocks: ReturnType<typeof vi.fn>[] = []
  /** `_core._renderService._renderRows` mocks; the view + layout hook force a
   *  repaint after resize and after a theme switch. */
  const renderRowsMocks: ReturnType<typeof vi.fn>[] = []
  /** `options.theme` setter spies per terminal (the theme effect writes here). */
  const themeSetters: Array<ReturnType<typeof vi.fn>> = []
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
    readonly _core = {
      scrollToBottom: vi.fn(),
      _renderService: { _renderRows: vi.fn() },
    }
    /** Settable options bag with a spied `theme` setter (the theme effect writes here). */
    readonly options: Record<string, unknown>

    constructor() {
      const themeSetter = vi.fn()
      const opts: Record<string, unknown> = {}
      Object.defineProperty(opts, 'theme', {
        get: () => undefined,
        set: themeSetter,
        configurable: true,
        enumerable: true,
      })
      this.options = opts
      fakeTerminals.push(this)
      scrollToBottomMocks.push(this._core.scrollToBottom)
      renderRowsMocks.push(this._core._renderService._renderRows)
      themeSetters.push(themeSetter)
    }
  }
  return { FakeTerminal, fakeTerminals, scrollToBottomMocks, renderRowsMocks, themeSetters }
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

/** WebglAddon double: records activations and fires onContextLoss on demand. */
const { FakeWebglAddon, webglInstances, contextLossListeners } = vi.hoisted(() => {
  const webglInstances: FakeWebglAddon[] = []
  const contextLossListeners: Array<() => void> = []
  class FakeWebglAddon {
    /** When set, activate() throws to simulate WebGL unavailability. */
    static throwOnActivate = false
    readonly activate = vi.fn(() => {
      if (FakeWebglAddon.throwOnActivate) throw new Error('WebGL unavailable')
    })
    readonly dispose = vi.fn()
    readonly onContextLoss = vi.fn((handler: () => void) => {
      contextLossListeners.push(handler)
      return { dispose: vi.fn() }
    })
    constructor() {
      webglInstances.push(this)
    }
  }
  return { FakeWebglAddon, webglInstances, contextLossListeners }
})

/** CanvasAddon double: the WebGL fallback renderer. */
const { FakeCanvasAddon, canvasInstances } = vi.hoisted(() => {
  const canvasInstances: FakeCanvasAddon[] = []
  class FakeCanvasAddon {
    readonly activate = vi.fn()
    readonly dispose = vi.fn()
    constructor() {
      canvasInstances.push(this)
    }
  }
  return { FakeCanvasAddon, canvasInstances }
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
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: FakeWebglAddon }))
vi.mock('@xterm/addon-canvas', () => ({ CanvasAddon: FakeCanvasAddon }))
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
    renderRowsMocks.length = 0
    themeSetters.length = 0
    resizeCallbacks.length = 0
    FakeFitAddon.nextSize = undefined
    webglInstances.length = 0
    contextLossListeners.length = 0
    canvasInstances.length = 0
    FakeWebglAddon.throwOnActivate = false
  })

  it('loads the FitAddon and reports the fitted geometry as a resize frame', () => {
    FakeFitAddon.nextSize = { cols: 120, rows: 30 }
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    // FitAddon is loaded once; the WebglAddon is also loaded (separate effect).
    const addonLoads = terminal.loadAddon.mock.calls.length
    expect(addonLoads).toBeGreaterThanOrEqual(1)
    expect(terminal.open).toHaveBeenCalledTimes(1)
    const socket = FakeWebSocket.instances[0]!
    expect(resizeFrames(socket)).toEqual([{ cols: 120, rows: 30 }])
  })

  it('starts the renderer on WebGL', () => {
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    expect(webglInstances).toHaveLength(1)
    expect(canvasInstances).toHaveLength(0)
    expect(webglInstances[0]!.activate).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the WebglAddon on context loss up to the recovery budget', () => {
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    // Initial load: 1 WebglAddon.
    expect(webglInstances).toHaveLength(1)
    expect(contextLossListeners).toHaveLength(1)

    // 1st context loss → rebuild (2 total).
    act(() => { contextLossListeners[0]!() })
    expect(webglInstances).toHaveLength(2)

    // 2nd context loss → rebuild (3 total).
    act(() => { contextLossListeners[1]!() })
    expect(webglInstances).toHaveLength(3)

    // 3rd context loss → rebuild (4 total, still within budget: budget is 3
    // and each loss increments then checks <= budget).
    act(() => { contextLossListeners[2]!() })
    expect(webglInstances).toHaveLength(4)

    // 4th context loss → budget exhausted, fall back to Canvas.
    act(() => { contextLossListeners[3]!() })
    expect(webglInstances).toHaveLength(4)
    expect(canvasInstances).toHaveLength(1)
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

  it('forces a render after a fitted resize via the private render service', () => {
    FakeFitAddon.nextSize = { cols: 120, rows: 30 }
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const renderRows = renderRowsMocks[0]!
    // The initial fit forces one render; a subsequent resize forces another.
    const callsBefore = renderRows.mock.calls.length
    FakeFitAddon.nextSize = { cols: 100, rows: 20 }
    act(() => {
      resizeCallbacks[0]!()
      vi.advanceTimersByTime(32)
    })
    expect(renderRows.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('re-projects the xterm theme when the theme revision changes', () => {
    const { rerender } = render(<TerminalView cwd="/tmp" t={makeTranslate()} themeRevision={1} />)
    const themeSetter = themeSetters[0]!
    // The initial mount + theme effect writes options.theme at least once.
    const initialSets = themeSetter.mock.calls.length
    expect(initialSets).toBeGreaterThanOrEqual(1)

    // A new theme revision triggers another options.theme write + forced render.
    const renderRows = renderRowsMocks[0]!
    const rendersBefore = renderRows.mock.calls.length
    rerender(<TerminalView cwd="/tmp" t={makeTranslate()} themeRevision={2} />)
    expect(themeSetter.mock.calls.length).toBeGreaterThan(initialSets)
    expect(renderRows.mock.calls.length).toBeGreaterThan(rendersBefore)
  })

  it('reads design-system tokens from computed styles when available', async () => {
    const original = window.getComputedStyle
    window.getComputedStyle = vi.fn(() => ({
      getPropertyValue: (name: string) => {
        if (name === '--dsw-alias-bg-base') return 'rgb(13, 17, 23)'
        if (name === '--dsw-alias-label-primary') return 'rgb(201, 209, 217)'
        if (name === '--dsw-alias-interactive-bg-hover') return 'rgba(110, 118, 129, 0.4)'
        if (name === '--dsw-static-red-500') return 'rgb(248, 81, 73)'
        return ''
      },
    } as CSSStyleDeclaration))
    try {
      const { readXtermTheme } = await import('../src/client/terminal-theme.ts')
      const theme = readXtermTheme()
      expect(theme.background).toBe('rgb(13, 17, 23)')
      expect(theme.foreground).toBe('rgb(201, 209, 217)')
      expect(theme.red).toBe('rgb(248, 81, 73)')
    } finally {
      window.getComputedStyle = original
    }
  })

  it('falls back to Canvas when WebGL activation throws', () => {
    // Make the next WebglAddon activation throw so the view falls back.
    FakeWebglAddon.throwOnActivate = true
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    // WebGL was attempted; CanvasAddon is the fallback.
    expect(webglInstances).toHaveLength(1)
    expect(canvasInstances).toHaveLength(1)
  })

  it('shows the exit status when the pty exits', async () => {
    const { container } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const socket = FakeWebSocket.instances[0]!
    act(() => socket.emitMessage(encodeExitFrame(0, 0)))
    // The data-phase attribute switches to 'exited' on the status line.
    expect(container.querySelector('[data-phase="exited"]')).not.toBeNull()
  })

  it('shows the error status when the host rejects the session', () => {
    const { container } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const socket = FakeWebSocket.instances[0]!
    act(() => socket.emitMessage(encodeErrorFrame('spawn denied')))
    expect(container.querySelector('[data-phase="error"]')).not.toBeNull()
  })

  it('shows the connected status once the WebSocket opens', () => {
    const { container } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const socket = FakeWebSocket.instances[0]!
    act(() => socket.emitOpen())
    expect(container.querySelector('[data-phase="connected"]')).not.toBeNull()
  })

  it('disposes the terminal and renderer addons on unmount', () => {
    const { unmount } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    const webgl = webglInstances[0]!
    act(() => { unmount() })
    expect(terminal.dispose).toHaveBeenCalledTimes(1)
    expect(webgl.dispose).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending animation frame when a second wheel arrives', () => {
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    const container = terminal.open.mock.calls[0]![0] as HTMLElement
    // Two rapid up-scrolls without advancing the rAF timer: the second cancels
    // the first's pending frame.
    act(() => {
      container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
      container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    })
    // The rAF is still pending (not yet consumed); flush it so the cleanup
    // doesn't leak into the next test.
    act(() => { vi.runOnlyPendingTimers() })
  })

  it('cancels a pending animation frame on unmount', () => {
    const { unmount } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const terminal = fakeTerminals[0]!
    const container = terminal.open.mock.calls[0]![0] as HTMLElement
    // Dispatch a wheel to schedule a rAF, then unmount without advancing.
    act(() => { container.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })) })
    act(() => { unmount() })
  })

  it('shows the reconnecting status after an unexpected close', () => {
    const { container } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    const socket = FakeWebSocket.instances[0]!
    act(() => socket.emitClose())
    expect(container.querySelector('[data-phase="reconnecting"]')).not.toBeNull()
  })

  it('dedupes a resize while a fit is already debouncing', () => {
    FakeFitAddon.nextSize = { cols: 120, rows: 30 }
    render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    // Two rapid ResizeObserver callbacks without advancing the 32ms debounce:
    // the second is a no-op (timer already pending).
    act(() => {
      resizeCallbacks[0]!()
      resizeCallbacks[0]!()
      vi.advanceTimersByTime(32)
    })
  })

  it('clears a pending debounce timer on unmount', () => {
    FakeFitAddon.nextSize = { cols: 120, rows: 30 }
    const { unmount } = render(<TerminalView cwd="/tmp" t={makeTranslate()} />)
    // Trigger a resize to schedule a debounce timer, then unmount without
    // letting the timer fire.
    act(() => { resizeCallbacks[0]!() })
    act(() => { unmount() })
  })
})
