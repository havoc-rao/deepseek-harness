/** Host contribution for the paper-tone bootstrap: embeds the durable tone's
 * per-scheme token variants so the first paint is tinted. The tone value
 * lives in this package's own settings namespace; the theme preference it
 * resolves the scheme from stays in the theme service's namespace. This
 * plugin owns the visual data, the durable section, and the injection row. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: pulls the settings service's Context merge (ctx.settings) the
// durable section registration reads.
import type {} from '@deepseek-ai/dsh-settings'
import { DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, type ThemePreference } from '@deepseek-ai/dsh-client-ui-theme'
import {
  DEFAULT_PAPER, PAPER_SETTINGS_NAMESPACE, PaperSettingsSchema, type PaperSettings, type PaperTone,
} from './paper-settings.ts'
import { paperBootInjection } from './boot-paper.ts'

/** Read the theme section's preference or the schema default without a settings provider. */
function readThemePreference(ctx: Context): ThemePreference {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_PREFERENCE
  const section = settings.get(THEME_SETTINGS_NAMESPACE) as { preference?: ThemePreference } | undefined
  return section?.preference ?? DEFAULT_PREFERENCE
}

/** Read the paper section's tone or the schema default without a settings provider. */
function readPaperTone(ctx: Context): PaperTone {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_PAPER
  const section = settings.get(PAPER_SETTINGS_NAMESPACE) as PaperSettings | undefined
  return section?.tone ?? DEFAULT_PAPER
}

/**
 * Register the durable paper section when the optional settings service is
 * composed, and answer every index injection collection with the paper-tone
 * bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(PAPER_SETTINGS_NAMESPACE, PaperSettingsSchema)
  })
  ctx.on('webserver/index-inject', (table) => {
    table.push(paperBootInjection(readThemePreference(ctx), readPaperTone(ctx)))
  })
}
