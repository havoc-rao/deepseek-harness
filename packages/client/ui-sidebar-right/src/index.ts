/** Host loader entry: registers the durable right-panel preference namespace. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { PANEL_SETTINGS_NAMESPACE, PanelSettingsSchema } from './panel-settings.ts'

/**
 * Register the durable panel section when the optional settings service is
 * composed, so a restarted app reopens the column the way the user left it.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(PANEL_SETTINGS_NAMESPACE, PanelSettingsSchema)
  })
}
