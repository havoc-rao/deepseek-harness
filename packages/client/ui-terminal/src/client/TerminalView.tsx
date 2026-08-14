/** xterm view binding one pty session to the terminal pane body. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITerminalAddon } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import '@xterm/xterm/css/xterm.css'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useTerminalLayout } from './useTerminalLayout'
import { useTerminalSocket, type TerminalSocketPhase } from './useTerminalSocket'
import { readXtermTheme } from './terminal-theme'
import css from './terminal.module.css'

/** Terminal view props: the `terminal` dictionary, the spawn cwd, and the theme revision. */
export type TerminalViewProps = PropsLocale<'terminal'> & {
  /** Working directory for the spawned shell; undefined inherits the host process cwd. */
  cwd?: string | undefined
  /**
   * Monotonic theme revision; changes on every palette switch (light/dark or
   * OS scheme flip). Drives a synchronous re-projection of the design-system
   * CSS variables onto `term.options.theme` before the browser paints, so the
   * terminal follows the page theme with no white flash.
   */
  themeRevision?: number | undefined
}

/** Status-line phase derived from the socket phase plus session-ending events. */
type TerminalStatusKind = 'error' | 'exited' | TerminalSocketPhase

/** Initial spawn geometry; the FitAddon + ResizeObserver refits it after layout. */
const TERMINAL_COLS = 80
const TERMINAL_ROWS = 24
/**
 * Maximum GPU context-loss recoveries before falling back to the Canvas
 * renderer. WebGL context loss can recur under VRAM pressure; a bounded retry
 * keeps the terminal usable without an unbounded reload loop.
 */
const WEBGL_RECOVERY_BUDGET = 3

/** System monospace font stack (no imported woff2 — no FOUT). */
const TERMINAL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace'

/**
 * Force a full repaint of the terminal renderer via the 5.5.x private API.
 * After a FitAddon resize the WebGL/Canvas renderer may hold a stale frame;
 * `renderService._renderRows` bypasses the render debouncer and repaints
 * immediately, avoiding a one-frame flicker on dimension change. Version-
 * sensitive: upgrading xterm requires regressing this module + patch tests.
 */
function forceRender(terminal: Terminal): void {
  const renderService = (terminal as unknown as {
    readonly _core?: { readonly _renderService?: { _renderRows(start: number, end: number): void } }
  })._core?._renderService
  renderService?._renderRows(0, terminal.rows - 1)
}

/**
 * xterm 5.5's `CoreTerminal` exposes `_disposables` but no `_store`; addon-webgl
 * 0.19.0's dispose cleanup reads `_core._store._isDisposed` (a xterm 6 private
 * field) and throws on the missing field — unmounting a WebGL terminal crashes
 * the `shell.overlay` slot entry and hides the toggle button. Planting a
 * disposed sentinel makes that cleanup short-circuit: the terminal is being
 * destroyed, so restoring the DOM renderer is moot. On xterm 6 the field
 * already exists and is left untouched. Remove once xterm and addon-webgl are
 * version-aligned.
 */
function patchWebglDisposeShim(addon: WebglAddon): void {
  const core = (addon as unknown as {
    readonly _terminal?: { readonly _core?: { _store?: { _isDisposed: boolean; dispose(): void } } }
  })._terminal?._core
  if (core !== undefined && core._store === undefined) {
    core._store = { _isDisposed: true, dispose() {} }
  }
}

/**
 * xterm assembly for one pty session: spawns the shell on mount, writes pty
 * output into the terminal, forwards keystrokes upstream, and shows a session
 * status line (exit code / host error / connection progress). Unmounting
 * disposes xterm; the socket hook asks the host to terminate the pty.
 *
 * The renderer starts on WebGL (hardware-accelerated) and rebuilds the addon up
 * to {@link WEBGL_RECOVERY_BUDGET} times on GPU context loss; beyond the
 * budget it falls back to the Canvas renderer. The terminal theme is
 * re-projected from the design-system CSS variables whenever the theme
 * revision changes (synchronously, before paint).
 * @param props - translated copy, spawn cwd, and theme revision.
 */
export function TerminalView(props: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | undefined>(undefined)
  /** The terminal instance once created; drives the FitAddon layout hook. */
  const [terminal, setTerminal] = useState<Terminal | undefined>(undefined)
  /**
   * True while the viewport sits at the bottom of the scrollback. New output
   * scrolls into view only then; an up-scroll pins the view and lets the user
   * read without being yanked back down.
   */
  const pinnedRef = useRef(true)
  /** Pending wheel re-pin check; cancelled on unmount so it never touches a disposed terminal. */
  const rafRef = useRef<number | undefined>(undefined)
  /** Patched `core.scrollToBottom`; undefined until the mount effect patches it, a no-op while pinned up. */
  const scrollToBottomRef = useRef<(() => void) | undefined>(undefined)
  const [exitCode, setExitCode] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const socket = useTerminalSocket({
    cwd: props.cwd,
    onOutput: (data, onConsumed) => {
      const current = terminalRef.current
      /* v8 ignore next -- defensive: terminal is created synchronously in the same commit as the socket */
      if (current === undefined) {
        // No terminal to render into yet; consume immediately so the ack
        // watermark keeps flowing once the socket connects.
        onConsumed()
        return
      }
      scrollToBottomRef.current?.()
      current.write(data, onConsumed)
    },
    onExit: (code) => { setExitCode(code) },
    onError: (message) => { setError(message) },
  })

  useTerminalLayout(terminal, containerRef, socket.resize)

  useEffect(() => {
    const container = containerRef.current
    /* v8 ignore next -- defensive: the ref is attached by the same render that mounts this effect */
    if (container === null) return
    const terminal = new Terminal({
      cols: TERMINAL_COLS,
      rows: TERMINAL_ROWS,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.0,
      scrollback: 5_000,
      theme: readXtermTheme(),
    })
    terminal.open(container)
    // xterm 5.x: `viewportY` is the line at the top of the viewport (moves on
    // up-scroll), while `baseY` is the top of the bottom page (the cursor line,
    // which stays at the bottom for any running shell). Only the
    // viewport-relative check flips when the user scrolls up.
    //
    // Pin state does NOT come from `onScroll`: xterm fires it only for
    // content-driven scroll (new lines), never for user wheel scroll (xterm.js
    // #3864, #3201). Unpin immediately on scroll-up — writes arriving before the
    // next animation frame must not yank the viewport back down — then re-check
    // on the next frame so scrolling back to the bottom re-pins. Capture phase:
    // xterm handles wheel events on its internal viewport element and may stop
    // propagation, so a bubbling listener on this container would never fire.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pinnedRef.current = false
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined
        const buffer = terminal.buffer.active
        pinnedRef.current = buffer.viewportY + terminal.rows >= buffer.length
      })
    }
    container.addEventListener('wheel', onWheel, { capture: true, passive: true })
    const disposeData = terminal.onData((data) => { socket.sendInput(data) })
    // Scroll-to-bottom is version-sensitive xterm internals (5.5.x `_core`).
    // The patch keeps the view pinned at the bottom while the user has not
    // scrolled up, and becomes a no-op the moment they do. `call` preserves
    // the method's `this` without binding a second function object.
    const core = (terminal as unknown as { readonly _core: { scrollToBottom: () => void } })._core
    const scrollToBottom = core.scrollToBottom.bind(core)
    core.scrollToBottom = () => { if (pinnedRef.current) scrollToBottom() }
    scrollToBottomRef.current = core.scrollToBottom
    terminalRef.current = terminal
    setTerminal(terminal)
    // Renderer addon lifecycle: start on WebGL (hardware-accelerated), rebuild
    // on GPU context loss up to the recovery budget, then fall back to Canvas.
    // Lives in this effect (not a separate [terminal] effect) so teardown can
    // dispose the renderer BEFORE the terminal: `Terminal.dispose` runs the
    // AddonManager, which disposes every loaded addon again — a still-active
    // WebGL addon crashes mid-teardown (reads `_isDisposed` on a half-released
    // renderer), crashing the shell.overlay slot entry and hiding the toggle.
    // With the addon already disposed that second pass is a no-op.
    let disposed = false
    /** The currently loaded renderer addon (WebGL or Canvas fallback). */
    let rendererAddon: ITerminalAddon | undefined
    /** Disposable for the current WebglAddon's context-loss listener. */
    let disposeContextLoss: { dispose(): void } | undefined
    /** GPU context-loss counter for this terminal lifetime. */
    let contextLossCount = 0

    const loadWebgl = (): void => {
      /* v8 ignore next -- race: only hit if context loss fires during teardown */
      if (disposed) return
      rendererAddon?.dispose()
      disposeContextLoss?.dispose()
      rendererAddon = undefined
      const addon = new WebglAddon()
      try {
        disposeContextLoss = addon.onContextLoss(() => {
          contextLossCount += 1
          if (contextLossCount <= WEBGL_RECOVERY_BUDGET) {
            loadWebgl()
          } else {
            loadCanvas()
          }
        })
        terminal.loadAddon(addon)
        rendererAddon = addon
        // addon-webgl 0.19.0 vs xterm 5.5: dispose cleanup reads the xterm 6
        // `_core._store` field; without the shim it throws and crashes the
        // shell.overlay slot on close (hiding the toggle button).
        patchWebglDisposeShim(addon)
      } catch {
        // WebGL unavailable (headless, no GPU, or context creation failure) —
        // fall back to the Canvas renderer so the terminal stays usable.
        disposeContextLoss?.dispose()
        disposeContextLoss = undefined
        addon.dispose()
        loadCanvas()
      }
    }

    const loadCanvas = (): void => {
      /* v8 ignore next -- race: only hit if fallback triggers during teardown */
      if (disposed) return
      rendererAddon?.dispose()
      disposeContextLoss?.dispose()
      disposeContextLoss = undefined
      rendererAddon = undefined
      const addon = new CanvasAddon()
      try {
        terminal.loadAddon(addon)
        rendererAddon = addon
      } /* v8 ignore next -- Canvas has no external deps; activation failure leaves the DOM renderer */ catch {
        addon.dispose()
      }
    }

    loadWebgl()
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      container.removeEventListener('wheel', onWheel)
      disposeData.dispose()
      terminalRef.current = undefined
      scrollToBottomRef.current = undefined
      disposed = true
      disposeContextLoss?.dispose()
      rendererAddon?.dispose()
      terminal.dispose()
    }
  }, [socket.sendInput])

  // Theme re-projection: run before the browser paints (useLayoutEffect) so
  // the xterm canvas adopts the new palette in the same frame the DOM
  // variables switch — no white flash between the page and the terminal. The
  // ThemePresenter (ui-layout) has already written the alias tokens to body
  // synchronously in the `theme/change` listener (ui-layout is a load-order
  // prerequisite of ui-terminal), so reading computed styles here sees the
  // resolved palette.
  useLayoutEffect(() => {
    if (terminal === undefined) return
    terminal.options.theme = readXtermTheme()
    forceRender(terminal)
  }, [terminal, props.themeRevision])

  const status: { kind: TerminalStatusKind; text: string } = error !== undefined
    ? { kind: 'error', text: `${props.t('status.error')}: ${error}` }
    : exitCode !== undefined
      ? { kind: 'exited', text: props.t('status.exited', { code: exitCode }) }
      : socket.phase === 'reconnecting'
        ? { kind: 'reconnecting', text: props.t('status.reconnecting') }
        : socket.phase === 'connecting'
          ? { kind: 'connecting', text: props.t('status.connecting') }
          : { kind: 'connected', text: '' }

  return (
    <div className={css.view} data-phase={status.kind}>
      <div ref={containerRef} className={css.screen} />
      <div className={css.status}>{status.text}</div>
    </div>
  )
}
