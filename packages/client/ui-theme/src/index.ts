/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { bootThemeInjection } from './boot-theme.ts'
import { DEFAULT_PAPER } from './paper-tones.ts'
import {
  DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type ThemeSettings,
} from './theme-settings.ts'

export { DEFAULT_PAPER, PAPER_TONES, type PaperTone } from './paper-tones.ts'
export {
  DEFAULT_PREFERENCE, THEME_PAPER_FIELD, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the registered section or use the schema defaults without a settings provider. */
function readSection(ctx: Context): ThemeSettings {
  const settings = ctx.get('settings')
  if (settings === undefined) return { preference: DEFAULT_PREFERENCE, paper: DEFAULT_PAPER }
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return { preference: DEFAULT_PREFERENCE, paper: DEFAULT_PAPER }
  return section
}

/**
 * Register the durable theme section when the optional settings service is
 * composed, and answer every index injection collection with the current
 * theme bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.on('webserver/index-inject', (table) => {
    const section = readSection(ctx)
    table.push(bootThemeInjection(section.preference, section.paper))
  })
}
