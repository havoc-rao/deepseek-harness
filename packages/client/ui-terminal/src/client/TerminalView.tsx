/** xterm view binding one pty session to the terminal pane body. */

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useTerminalLayout } from './useTerminalLayout'
import { useTerminalSocket, type TerminalSocketPhase } from './useTerminalSocket'
import css from './terminal.module.css'

/** Terminal view props: the `terminal` dictionary plus the spawn working directory. */
export type TerminalViewProps = PropsLocale<'terminal'> & {
  /** Working directory for the spawned shell; undefined inherits the host process cwd. */
  cwd?: string | undefined
}

/** Status-line phase derived from the socket phase plus session-ending events. */
type TerminalStatusKind = 'error' | 'exited' | TerminalSocketPhase

/** Initial spawn geometry; the FitAddon + ResizeObserver refits it after layout. */
const TERMINAL_COLS = 80
const TERMINAL_ROWS = 24

/**
 * xterm assembly for one pty session: spawns the shell on mount, writes pty
 * output into the terminal, forwards keystrokes upstream, and shows a session
 * status line (exit code / host error / connection progress). Unmounting
 * disposes xterm; the socket hook asks the host to terminate the pty.
 * @param props - translated copy.
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
  /** Patched `core.scrollToBottom`; a no-op while the view is pinned up. */
  const scrollToBottomRef = useRef<() => void>(() => {})
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
      scrollToBottomRef.current()
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
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 5_000,
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
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
    const core = (terminal as unknown as { readonly _core: { scrollToBottom(): void } })._core
    const scrollToBottom = core.scrollToBottom
    core.scrollToBottom = () => { if (pinnedRef.current) scrollToBottom.call(core) }
    scrollToBottomRef.current = core.scrollToBottom
    terminalRef.current = terminal
    setTerminal(terminal)
    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      container.removeEventListener('wheel', onWheel)
      disposeData.dispose()
      terminalRef.current = undefined
      scrollToBottomRef.current = () => {}
      terminal.dispose()
    }
  }, [socket.sendInput])

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
