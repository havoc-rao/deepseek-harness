/** Host contribution for the paper-tone bootstrap: embeds the durable tone's
 * per-scheme token variants so the first paint is tinted. The tone value
 * lives in the theme service's settings namespace; this plugin owns the
 * visual data and the injection row. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_PAPER, DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, type PaperTone, type ThemePreference,
} from '@deepseek-ai/dsh-client-ui-theme'
import { paperBootInjection } from './boot-paper.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the theme section or fall back to the schema defaults without a settings provider. */
function readThemeSection(ctx: Context): { preference: ThemePreference; paper: PaperTone } {
  const settings = ctx.get('settings')
  if (settings === undefined) return { preference: DEFAULT_PREFERENCE, paper: DEFAULT_PAPER }
  const section = settings.get(THEME_NAMESPACE) as
    { preference?: ThemePreference; paper?: PaperTone } | undefined
  return {
    preference: section?.preference ?? DEFAULT_PREFERENCE,
    paper: section?.paper ?? DEFAULT_PAPER,
  }
}

/**
 * Answer every index injection collection with the paper-tone bootstrap row.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.on('webserver/index-inject', (table) => {
    const section = readThemeSection(ctx)
    table.push(paperBootInjection(section.preference, section.paper))
  })
}
