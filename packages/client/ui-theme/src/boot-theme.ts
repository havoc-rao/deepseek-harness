/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference and paper tone; the
 * browser resolves only `system`, then writes the same DOM fields ui-layout's
 * ThemePresenter owns after the client plugin tree activates, plus the active
 * tone's alias-token variants as inline variables so the first paint is
 * already tinted.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { DEFAULT_PAPER, PAPER_TONE_LAYERS, type PaperTone } from './paper-tones.ts'
import { DEFAULT_PREFERENCE, type ThemePreference } from './theme-settings.ts'

/** Build the inline script body for one schema-validated built-in preference and paper tone. */
function bootThemeScript(preference: ThemePreference, paper: PaperTone): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  const paperTokens = ${JSON.stringify(PAPER_TONE_LAYERS[paper])}
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  for (const [name, modes] of Object.entries(paperTokens)) {
    document.body.style.setProperty(name, modes[dark ? 'dark' : 'light'])
  }
})()`
}

/**
 * The theme bootstrap as an injection row: an inline script immediately after
 * the opening body tag, before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @param paper - Current Host-backed paper tone (default tints nothing).
 * @returns the body script row.
 */
export function bootThemeInjection(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  paper: PaperTone = DEFAULT_PAPER,
): IndexInjection {
  return { kind: 'script', placement: 'body', text: bootThemeScript(preference, paper) }
}
