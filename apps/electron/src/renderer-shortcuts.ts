/**
 * The main-process side of the renderer shortcut bridge: a 'cmd-w' router
 * handler that asks one window's page (through its preload's
 * dshDesktopShell) whether it claims the press, and resolves with the
 * preload's reply. The page never receives the key itself — window.ts
 * intercepts Cmd+W in before-input-event — so the reply is the only page
 * input. Each window owns one bridge over the global claim channel; a reply
 * routes to its ask by request id, so other windows ignore it.
 *
 * This module is pure logic: the caller wires webContents.send and the
 * ipcMain claim listener (window.ts), which keeps the unit tests free of an
 * Electron runtime.
 */
import { randomUUID } from 'node:crypto'
import type { ShortcutRouter } from './shortcuts.ts'

/** The main→renderer ask channel; payload `{ name, requestId }`. */
export const SHELL_SHORTCUT_CHANNEL = 'dsh:shell-shortcut'
/** The renderer→main claim channel; payload `{ name, requestId, claimed }`. */
export const SHELL_SHORTCUT_CLAIM_CHANNEL = 'dsh:shell-shortcut-claim'
/** How long an ask waits for the page's reply before it settles as unclaimed. */
export const SHELL_SHORTCUT_TIMEOUT_MS = 1500

/** The preload's reply to one ask. */
export interface ShortcutClaimReply {
  readonly name: string
  readonly requestId: string
  readonly claimed: boolean
}

/** Sends one ask to a window's webContents. */
export type ShortcutAskSender = (name: string, requestId: string) => void

/** One ask awaiting the page's reply. */
interface PendingAsk {
  readonly timer: ReturnType<typeof setTimeout>
  resolve: (claimed: boolean) => void
}

/**
 * The claim bookkeeping for one window. Wiring (webContents, ipcMain) stays
 * with the caller.
 */
export interface RendererShortcutBridge {
  /**
   * Ask the page whether it claims `name`. Resolves `true` only on the
   * preload's explicit claim; an unclaimed reply, no reply before the
   * timeout, or a disposed bridge all resolve `false` so the press keeps the
   * window's default (the close-confirmation dialog).
   */
  ask(name: string): Promise<boolean>
  /** The preload's reply; settles the matching ask and ignores unknown request ids. */
  receiveClaim(reply: ShortcutClaimReply): void
  /** Settle every pending ask as unclaimed and drop the pending state. */
  dispose(): void
}

export function createRendererShortcutBridge(
  send: ShortcutAskSender,
  timeoutMs: number = SHELL_SHORTCUT_TIMEOUT_MS,
): RendererShortcutBridge {
  const pending = new Map<string, PendingAsk>()
  let disposed = false
  const settle = (requestId: string, claimed: boolean): void => {
    const ask = pending.get(requestId)
    if (ask === undefined) return
    pending.delete(requestId)
    clearTimeout(ask.timer)
    ask.resolve(claimed)
  }
  return {
    ask(name) {
      const requestId = randomUUID()
      return new Promise<boolean>((resolve) => {
        if (disposed) {
          resolve(false)
          return
        }
        const timer = setTimeout(() => { settle(requestId, false) }, timeoutMs)
        pending.set(requestId, { timer, resolve })
        send(name, requestId)
      })
    },
    receiveClaim(reply) {
      settle(reply.requestId, reply.claimed)
    },
    dispose() {
      disposed = true
      for (const ask of pending.values()) {
        clearTimeout(ask.timer)
        ask.resolve(false)
      }
      pending.clear()
    },
  }
}

/** The window surface the bridge reads and sends to; satisfies BrowserWindow's relevant parts. */
export interface ShortcutBridgeWindow {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    isLoading(): boolean
    send(channel: string, payload: unknown): void
  }
  on(event: 'closed', listener: () => void): void
}

/**
 * Register the renderer bridge as the 'cmd-w' router handler for one window.
 * A destroyed or still-loading window answers unclaimed without asking,
 * since its page cannot hold a consumer yet. The returned disposer
 * unregisters the handler and settles the bridge; the window's `closed`
 * event runs it as well.
 * @param win - the window to ask; only this window's webContents receives asks.
 * @param router - the shortcut router to register on.
 */
export function registerRendererShortcuts(win: ShortcutBridgeWindow, router: ShortcutRouter): {
  readonly bridge: RendererShortcutBridge
  dispose: () => void
} {
  const bridge = createRendererShortcutBridge(
    (name, requestId) => { win.webContents.send(SHELL_SHORTCUT_CHANNEL, { name, requestId }) },
  )
  const unregister = router.register('cmd-w', () => {
    if (win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isLoading()) return false
    return bridge.ask('cmd-w')
  })
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unregister()
    bridge.dispose()
  }
  win.on('closed', dispose)
  return { bridge, dispose }
}
