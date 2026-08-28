/**
 * Paper-tone bootstrap row for the browser's pre-plugin interval. Reads the
 * same durable `ui-theme` section the theme host embeds its preference from,
 * then writes the tone's per-scheme token variants as inline body variables
 * so the first paint is already tinted. Runs as its own body script right
 * after ui-theme's row; the dark resolution mirrors that script so the two
 * stay consistent regardless of listener order.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type { PaperTone, ThemePreference } from '@deepseek-ai/dsh-client-ui-theme'
import { PAPER_TONE_LAYERS } from './paper-tones.ts'

/** Build the inline script body for one durable preference/paper pair. */
function paperBootScript(preference: ThemePreference, paper: PaperTone): string {
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  const paperTokens = ${JSON.stringify(PAPER_TONE_LAYERS[paper])}
  for (const [name, modes] of Object.entries(paperTokens)) {
    document.body.style.setProperty(name, modes[dark ? 'dark' : 'light'])
  }
})()`
}

/**
 * The paper-tone bootstrap as an injection row: an inline body script after
 * the theme row, before the shell mount and module script.
 * @param preference - Current Host-backed built-in theme preference.
 * @param paper - Current Host-backed paper tone (default tints nothing).
 * @returns the body script row.
 */
export function paperBootInjection(
  preference: ThemePreference,
  paper: PaperTone,
): IndexInjection {
  return { kind: 'script', placement: 'body', text: paperBootScript(preference, paper) }
}
