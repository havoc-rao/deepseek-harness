/**
 * Paper-tone preference stored in the Host user-settings document. The paper
 * feature owns its whole contract: the tone vocabulary, the settings
 * namespace/field, and the durable schema. Visual data lives in
 * `paper-tones.ts`; the theme service only receives the active tone's layer
 * through `overrideTokens`.
 */

import z from '@deepseek-ai/schemastery'

/** Built-in paper tones accepted at the settings boundary. */
export const PAPER_TONES = ['default', 'cream', 'sepia', 'green'] as const

/** Settings namespace owned by the paper plugin. */
export const PAPER_SETTINGS_NAMESPACE = 'ui-paper'

/** Field carrying the selected paper tone. */
export const PAPER_TONE_FIELD = 'tone'

/** Selectable paper tone; `default` tints nothing. */
export type PaperTone = typeof PAPER_TONES[number]

/** Default tone when the user-settings document has no override. */
export const DEFAULT_PAPER: PaperTone = 'default'

/** Durable paper section shared by the Host schema and the browser scope. */
export interface PaperSettings {
  /** Selected paper tone (independent of the theme preference). */
  tone: PaperTone
}

/** Durable paper schema; also the wire envelope the browser scope validates against. */
export const PaperSettingsSchema: z<PaperSettings> = z.object({
  [PAPER_TONE_FIELD]: z.union([...PAPER_TONES]).default(DEFAULT_PAPER),
})

/**
 * Narrow one wire or registry value to a selectable tone.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in paper tone.
 */
export function isPaperTone(value: unknown): value is PaperTone {
  return PAPER_TONES.some(tone => tone === value)
}
