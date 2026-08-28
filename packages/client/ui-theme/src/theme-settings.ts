/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the selected paper tone, independent of the preference. */
export const THEME_PAPER_FIELD = 'paper'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/**
 * Built-in paper tones accepted at the settings boundary — the schema
 * contract the `ui-paper` feature plugin builds its layer table and UI
 * against. The visual layer data lives in that plugin; the vocabulary stays
 * with the durable field.
 */
export const PAPER_TONES = ['default', 'cream', 'sepia', 'green'] as const

/** Paper tone selected by the Appearance surface, independent of the base scheme. */
export type PaperTone = typeof PAPER_TONES[number]

/** Default tone when the user-settings document has no override. */
export const DEFAULT_PAPER: PaperTone = 'default'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Selected paper tone (independent axis; default tints nothing). */
  paper: PaperTone
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [THEME_PAPER_FIELD]: z.union([...PAPER_TONES]).default(DEFAULT_PAPER),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
