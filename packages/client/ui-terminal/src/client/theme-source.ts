/**
 * Theme snapshot observable adapter: bridges ui-theme's `ctx.theme` service
 * (getTheme + `theme/change` event) to the `HostObservable` shape the slot
 * renderer binds as a `useTheme` selector hook. The plugin body owns one
 * instance and hands it through the shell.overlay registration's `hooks`
 * compartment; the component side reads resolved snapshots without touching
 * the cordis context.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'

/**
 * Build a host observable over the resolved theme snapshots.
 * @param ctx - owning cordis context (the `theme/change` listener is
 * ctx-bound, so it is released automatically when the plugin fiber disposes).
 * @param theme - the theme runtime service (getTheme + theme/change owner).
 * @returns a HostObservable whose getSnapshot returns the latest immutable
 * snapshot and whose subscribe forwards the `theme/change` event.
 */
export function createThemeSource(ctx: Context, theme: ThemeRuntime): HostObservable<ThemeSnapshot> {
  return {
    getSnapshot: () => theme.getTheme(),
    subscribe: listener => ctx.on('theme/change', () => { listener() }),
  }
}
