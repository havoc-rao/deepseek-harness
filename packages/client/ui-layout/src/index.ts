/** Host loader entry: registers the durable layout preference namespace. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { LAYOUT_SETTINGS_NAMESPACE, LayoutSettingsSchema } from './layout-settings.ts'

/**
 * Register the durable layout section when the optional settings service is
 * composed, so a restarted app restores the user's right-panel width.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(LAYOUT_SETTINGS_NAMESPACE, LayoutSettingsSchema)
  })
}
