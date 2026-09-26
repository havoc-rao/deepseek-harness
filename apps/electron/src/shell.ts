/**
 * Desktop-shell marker for the host plugin tree. The shared 'web' profile is
 * booted both by the CLI (`dsh web`) and inside the Electron main process
 * (apps/electron/src/host.ts), so a plugin cannot tell which host it runs
 * under from the profile alone. This module provides the explicit signal.
 * @module @deepseek-ai/dsh-electron/shell
 */

import type { Context } from '@deepseek-ai/cordis'

/** The provided-property key; matches the augmented Context member name. */
export const DESKTOP_SHELL_KEY = 'desktopShell' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * `true` when the tree runs inside the Electron desktop shell; absent
     * under the plain CLI/web hosts. Provided before the tree mounts.
     */
    desktopShell?: boolean
  }
}

/**
 * Provide the desktop-shell marker on a host context before any entry mounts.
 * @param ctx - the host context the tree will mount under.
 */
export function provideDesktopShell(ctx: Context): void {
  ctx.provide(DESKTOP_SHELL_KEY, true)
}
