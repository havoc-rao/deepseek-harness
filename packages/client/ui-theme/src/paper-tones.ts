/**
 * Paper-tone axis: product-fixed surface recolor layers independent of the
 * light/dark/system preference axis. Each tone carries `{ light, dark }`
 * values for every alias token it touches, so the tonal choice survives OS
 * scheme flips — the system only selects which of the tone's two variants
 * applies, never which tone. Shared by the Host bootstrap (pre-hydration
 * tint) and the browser ThemeRuntime (folded into the composed snapshot);
 * the module must stay DOM- and React-free.
 */

/** One override-layer token value: both palette modes are mandatory (repeat
 * the same value when the token is scheme-invariant) so an override never
 * goes illegible when the user switches to the other scheme.
 */
export interface ThemeTokenModes {
  /** Value applied while the light base palette is active. */
  light: string
  /** Value applied while the dark base palette is active. */
  dark: string
}

/** Override-layer dictionary: token names to per-mode value pairs. */
export type ThemeTokenOverrides = Record<string, ThemeTokenModes>

/** Theme token dictionary: --dsw-alias-* overrides keyed by variable name. */
export type ThemeTokens = Record<string, string>

/** Built-in paper tones accepted at the settings boundary. */
export const PAPER_TONES = ['default', 'cream', 'sepia', 'green'] as const

/** Paper tone selected by the Appearance row, independent of the base scheme. */
export type PaperTone = typeof PAPER_TONES[number]

/** Default tone when the user-settings document has no override. */
export const DEFAULT_PAPER: PaperTone = 'default'

/**
 * Per-tone alias-token layers. `default` overrides nothing — the base
 * palettes stay authoritative. The v1 set covers the reading surfaces (app
 * base and layers, sidebar, chat bubble, inputs, code blocks); extending the
 * list is a token-design task, not a code change.
 */
export const PAPER_TONE_LAYERS: Record<PaperTone, ThemeTokenOverrides> = Object.freeze({
  default: Object.freeze({}),
  cream: Object.freeze({
    '--dsw-alias-bg-base': { light: 'rgb(253, 251, 246)', dark: 'rgb(27, 26, 24)' },
    '--dsw-alias-bg-layer-1': { light: 'rgb(252, 249, 243)', dark: 'rgb(37, 35, 32)' },
    '--dsw-alias-bg-layer-2': { light: 'rgb(250, 246, 238)', dark: 'rgb(45, 43, 39)' },
    '--dsw-alias-bg-layer-3': { light: 'rgb(248, 243, 234)', dark: 'rgb(53, 50, 45)' },
    '--dsw-alias-bg-module-platform': { light: 'rgb(247, 242, 233)', dark: 'rgb(53, 50, 45)' },
    '--dsw-alias-markdown-code-block': { light: 'rgb(248, 244, 237)', dark: 'rgb(35, 33, 30)' },
    '--dsw-alias-markdown-code-block-banner': { light: 'rgb(247, 243, 235)', dark: 'rgb(45, 43, 39)' },
    '--dsw-alias-markdown-placeholder': { light: 'rgb(246, 242, 235)', dark: 'rgb(45, 43, 39)' },
    '--dsw-specific-sidebar-fill': { light: 'rgb(250, 247, 241)', dark: 'rgb(31, 30, 27)' },
    '--dsw-specific-bubble': { light: 'rgb(244, 240, 232)', dark: 'rgb(45, 43, 39)' },
    '--dsw-specific-bubble-highlight': { light: 'rgb(235, 228, 214)', dark: 'rgb(66, 62, 55)' },
    '--dsw-specific-input-major': { light: 'rgb(255, 253, 248)', dark: 'rgb(45, 43, 39)' },
    '--dsw-specific-login-input': { light: 'rgb(250, 247, 240)', dark: 'rgb(35, 33, 30)' },
    '--dsw-specific-selector': { light: 'rgb(247, 243, 235)', dark: 'rgb(53, 50, 45)' },
    '--dsw-specific-tip': { light: 'rgb(247, 243, 235)', dark: 'rgb(53, 50, 45)' },
  }),
  sepia: Object.freeze({
    '--dsw-alias-bg-base': { light: 'rgb(250, 244, 231)', dark: 'rgb(26, 23, 20)' },
    '--dsw-alias-bg-layer-1': { light: 'rgb(248, 240, 225)', dark: 'rgb(36, 32, 27)' },
    '--dsw-alias-bg-layer-2': { light: 'rgb(245, 236, 218)', dark: 'rgb(44, 39, 33)' },
    '--dsw-alias-bg-layer-3': { light: 'rgb(241, 231, 211)', dark: 'rgb(52, 46, 39)' },
    '--dsw-alias-bg-module-platform': { light: 'rgb(241, 231, 211)', dark: 'rgb(52, 46, 39)' },
    '--dsw-alias-markdown-code-block': { light: 'rgb(243, 234, 218)', dark: 'rgb(34, 30, 25)' },
    '--dsw-alias-markdown-code-block-banner': { light: 'rgb(241, 231, 211)', dark: 'rgb(44, 39, 33)' },
    '--dsw-alias-markdown-placeholder': { light: 'rgb(240, 230, 212)', dark: 'rgb(44, 39, 33)' },
    '--dsw-specific-sidebar-fill': { light: 'rgb(246, 238, 222)', dark: 'rgb(31, 27, 23)' },
    '--dsw-specific-bubble': { light: 'rgb(243, 233, 216)', dark: 'rgb(44, 39, 33)' },
    '--dsw-specific-bubble-highlight': { light: 'rgb(230, 215, 190)', dark: 'rgb(66, 58, 48)' },
    '--dsw-specific-input-major': { light: 'rgb(252, 247, 237)', dark: 'rgb(44, 39, 33)' },
    '--dsw-specific-login-input': { light: 'rgb(246, 238, 222)', dark: 'rgb(34, 30, 25)' },
    '--dsw-specific-selector': { light: 'rgb(242, 232, 213)', dark: 'rgb(52, 46, 39)' },
    '--dsw-specific-tip': { light: 'rgb(242, 232, 213)', dark: 'rgb(52, 46, 39)' },
  }),
  green: Object.freeze({
    '--dsw-alias-bg-base': { light: 'rgb(248, 251, 246)', dark: 'rgb(22, 25, 22)' },
    '--dsw-alias-bg-layer-1': { light: 'rgb(244, 249, 241)', dark: 'rgb(31, 35, 31)' },
    '--dsw-alias-bg-layer-2': { light: 'rgb(240, 247, 236)', dark: 'rgb(39, 44, 38)' },
    '--dsw-alias-bg-layer-3': { light: 'rgb(235, 244, 230)', dark: 'rgb(46, 52, 45)' },
    '--dsw-alias-bg-module-platform': { light: 'rgb(235, 244, 230)', dark: 'rgb(46, 52, 45)' },
    '--dsw-alias-markdown-code-block': { light: 'rgb(238, 245, 234)', dark: 'rgb(30, 34, 29)' },
    '--dsw-alias-markdown-code-block-banner': { light: 'rgb(235, 244, 230)', dark: 'rgb(39, 44, 38)' },
    '--dsw-alias-markdown-placeholder': { light: 'rgb(234, 242, 230)', dark: 'rgb(39, 44, 38)' },
    '--dsw-specific-sidebar-fill': { light: 'rgb(242, 247, 238)', dark: 'rgb(26, 30, 26)' },
    '--dsw-specific-bubble': { light: 'rgb(236, 244, 231)', dark: 'rgb(39, 44, 38)' },
    '--dsw-specific-bubble-highlight': { light: 'rgb(219, 233, 211)', dark: 'rgb(60, 68, 58)' },
    '--dsw-specific-input-major': { light: 'rgb(251, 253, 248)', dark: 'rgb(39, 44, 38)' },
    '--dsw-specific-login-input': { light: 'rgb(242, 247, 238)', dark: 'rgb(30, 34, 29)' },
    '--dsw-specific-selector': { light: 'rgb(237, 245, 232)', dark: 'rgb(46, 52, 45)' },
    '--dsw-specific-tip': { light: 'rgb(237, 245, 232)', dark: 'rgb(46, 52, 45)' },
  }),
})

/**
 * The tone's paper-identity color for the selection-panel swatch: its light
 * `--dsw-alias-bg-base` variant (the hue family communicates best in light
 * form — the dark variants are near-indistinguishable). `default` tints
 * nothing and falls back to the neutral paper white.
 * @param tone - built-in paper tone.
 * @returns a CSS color string.
 */
export function paperToneSwatch(tone: PaperTone): string {
  return PAPER_TONE_LAYERS[tone]['--dsw-alias-bg-base']?.light ?? 'rgb(255, 255, 255)'
}
