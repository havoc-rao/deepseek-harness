/**
 * The desktop shortcut router: the typed decision point for shell-level
 * shortcuts. The window intercepts Cmd+W before the renderer
 * (apps/electron/src/window.ts) and routes it through `ctx.desktopShortcuts`;
 * a handler that returns `true` claims the press, an unclaimed press keeps
 * the window's default (the close-confirmation dialog).
 *
 * The router is provided on the electron-profile host context before the tree
 * mounts (provideDesktopShortcuts in apps/electron/src/host.ts), so any
 * main-process plugin can claim a shortcut without touching the window code.
 * The renderer cannot reach it: a page-side consumer requires the later
 * preload/IPC bridge, which registers as a handler here.
 * @module @deepseek-ai/dsh-electron/shortcuts
 */

import type { Context } from '@deepseek-ai/cordis'

/** The shell-level shortcuts the router knows; extend as new shortcuts route through the window. */
export type DesktopShortcut = 'cmd-w'

/**
 * A shortcut handler. `true` claims the press; `false` or `undefined` passes
 * it to the next handler. A returned promise is awaited before the next
 * handler runs.
 */
export type DesktopShortcutHandler = (shortcut: DesktopShortcut) => boolean | void | Promise<boolean | void>

/** Routes shell-level shortcuts to registered handlers, in registration order. */
export interface ShortcutRouter {
  /**
   * Register a handler for one shortcut.
   * @param shortcut - the shortcut to claim.
   * @param handler - called on each press of the shortcut.
   * @returns a disposer that removes exactly this registration.
   */
  register(shortcut: DesktopShortcut, handler: DesktopShortcutHandler): () => void
  /**
   * Run the shortcut's handlers until one claims it.
   * @param shortcut - the shortcut to route.
   * @returns `'claimed'` when a handler returned `true`, otherwise `'unclaimed'`.
   */
  route(shortcut: DesktopShortcut): Promise<'claimed' | 'unclaimed'>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The main-process shortcut router; provided before the tree mounts. */
    desktopShortcuts?: ShortcutRouter
  }
}

/** One registration entry, so a disposer removes its own registration even when the same handler registered twice. */
interface Registration {
  handler: DesktopShortcutHandler
}

/** Create the router implementation. The window routes through it; handlers claim or pass. */
export function createShortcutRouter(): ShortcutRouter {
  const registrations = new Map<DesktopShortcut, Registration[]>()
  return {
    register(shortcut, handler) {
      const entry: Registration = { handler }
      const group = registrations.get(shortcut) ?? []
      group.push(entry)
      registrations.set(shortcut, group)
      return () => {
        const current = registrations.get(shortcut)
        if (current === undefined) return
        const index = current.indexOf(entry)
        if (index === -1) return
        current.splice(index, 1)
        if (current.length === 0) registrations.delete(shortcut)
      }
    },
    async route(shortcut) {
      const group = registrations.get(shortcut)
      if (group === undefined) return 'unclaimed'
      for (const entry of [...group]) {
        if (await entry.handler(shortcut)) return 'claimed'
      }
      return 'unclaimed'
    },
  }
}

/**
 * Provide the shortcut router on a host context before any tree entry mounts.
 * @param ctx - the host context the tree will mount under.
 */
export function provideDesktopShortcuts(ctx: Context): void {
  ctx.provide('desktopShortcuts', createShortcutRouter())
}
