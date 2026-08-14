/**
 * Terminal theme mapping: projects the resolved design-system CSS variables
 * (applied to `body` by ui-layout's ThemePresenter) onto xterm's `ITheme`.
 * Reads computed styles rather than hardcoded color values, so the terminal
 * follows the active palette without value drift. The ANSI 16-color palette
 * uses the design system's theme-invariant `--dsw-static-*` tokens; the
 * background/foreground/cursor/selection fields use the theme-dependent
 * `--dsw-alias-*` tokens.
 */

import type { ITheme } from '@xterm/xterm'

/**
 * Fallback theme used when the design tokens are unavailable (no document, no
 * stylesheet, or a non-browser test harness). Keeps the terminal legible. The
 * narrow interface makes every field a required `string` (xterm's `ITheme`
 * fields are optional), so lookups need no non-null assertion.
 */
interface FallbackTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionInactiveBackground: string
}

const FALLBACK_THEME: Readonly<FallbackTheme> = Object.freeze({
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  cursorAccent: '#1e1e1e',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  selectionInactiveBackground: 'rgba(255, 255, 255, 0.08)',
})

/**
 * Theme-dependent alias tokens read from the active palette. These change when
 * the user switches between light and dark; each maps to one xterm theme field.
 */
const ALIAS_TOKENS = {
  background: '--dsw-alias-bg-base',
  foreground: '--dsw-alias-label-primary',
  selectionBackground: '--dsw-alias-interactive-bg-hover',
} as const

/**
 * Theme-invariant static tokens for the ANSI 16-color palette. Both light and
 * dark base palettes define identical `--dsw-static-*` values, so these colors
 * are stable across theme switches — only the alias layer (background,
 * foreground, cursor, selection) follows the active scheme.
 */
const ANSI_TOKENS = {
  black: '--dsw-static-neutral-bluish-1000',
  red: '--dsw-static-red-500',
  green: '--dsw-static-green-500',
  yellow: '--dsw-static-amber-500',
  blue: '--dsw-static-blue-500',
  magenta: '--dsw-static-deepseek-500',
  cyan: '--dsw-static-blue-450',
  white: '--dsw-static-neutral-bluish-100',
  brightBlack: '--dsw-static-neutral-bluish-700',
  brightRed: '--dsw-static-red-400',
  brightGreen: '--dsw-static-green-400',
  brightYellow: '--dsw-static-amber-400',
  brightBlue: '--dsw-static-blue-400',
  brightMagenta: '--dsw-static-deepseek-400',
  brightCyan: '--dsw-static-blue-300',
  brightWhite: '--dsw-static-neutral-bluish-50',
} as const

/** Read one resolved CSS custom property from the body, trimmed. */
function readToken(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim()
}

/**
 * Build an xterm `ITheme` from the design-system CSS variables currently
 * resolved on `document.body`. Must run after ui-layout's ThemePresenter has
 * applied the active snapshot to the DOM (the `theme/change` event fires the
 * presenter synchronously before any consumer listener, because ui-layout is a
 * load-order prerequisite of ui-terminal). Returns a frozen fallback when the
 * document or computed styles are unavailable.
 * @returns the xterm theme object for `term.options.theme`.
 */
export function readXtermTheme(): ITheme {
  /* v8 ignore next -- non-browser: jsdom always defines document/getComputedStyle */
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return FALLBACK_THEME
  }
  const style = getComputedStyle(document.body)
  const background = readToken(style, ALIAS_TOKENS.background)
  const foreground = readToken(style, ALIAS_TOKENS.foreground)
  const selection = readToken(style, ALIAS_TOKENS.selectionBackground)
  const theme: ITheme = {
    background: background || FALLBACK_THEME.background,
    foreground: foreground || FALLBACK_THEME.foreground,
    cursor: foreground || FALLBACK_THEME.cursor,
    cursorAccent: background || FALLBACK_THEME.cursorAccent,
    selectionBackground: selection || FALLBACK_THEME.selectionBackground,
    selectionInactiveBackground: selection || FALLBACK_THEME.selectionInactiveBackground,
  }
  for (const [field, token] of Object.entries(ANSI_TOKENS)) {
    const value = readToken(style, token)
    if (value !== '') (theme as Record<string, string>)[field] = value
  }
  return theme
}
