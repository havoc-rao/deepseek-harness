/**
 * Keep the xterm geometry in step with its container: a ResizeObserver
 * debounces size changes for 32 ms, then a FitAddon refits the terminal and
 * reports the new cols/rows through {@link onResize} when either dimension
 * actually changed. A no-op fit sends nothing, so layout churn (panel drag,
 * devtools resize, font swap) cannot flood the pty with duplicate resize
 * frames. Fitting runs only once the terminal instance exists; a hidden
 * container defers the fit to the next ResizeObserver event.
 */

import { useEffect, useRef, type RefObject } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

/** Debounce window for container size changes before a fit runs. */
const RESIZE_DEBOUNCE_MS = 32

/**
 * Fit the terminal into its container and report dimension changes.
 * @param terminal - the xterm instance to fit; undefined defers until it exists.
 * @param containerRef - the element the terminal was opened into.
 * @param onResize - receives a new cols/rows pair after a changing fit.
 */
export function useTerminalLayout(
  terminal: Terminal | undefined,
  containerRef: RefObject<HTMLDivElement | null>,
  onResize: (cols: number, rows: number) => void,
): void {
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize
  const lastSizeRef = useRef<{ readonly cols: number; readonly rows: number } | undefined>(undefined)

  useEffect(() => {
    const container = containerRef.current
    if (terminal === undefined || container === null) return
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    let timer: number | undefined

    const fit = (): void => {
      timer = undefined
      try {
        fitAddon.fit()
      } catch {
        // The container is not measurable yet (for example a hidden panel);
        // the next ResizeObserver event retries the fit.
        return
      }
      const size = { cols: terminal.cols, rows: terminal.rows }
      const last = lastSizeRef.current
      if (last === undefined || last.cols !== size.cols || last.rows !== size.rows) {
        lastSizeRef.current = size
        onResizeRef.current(size.cols, size.rows)
      }
    }

    fit()
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) return
      timer = window.setTimeout(fit, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (timer !== undefined) window.clearTimeout(timer)
      fitAddon.dispose()
    }
  }, [terminal, containerRef])
}
