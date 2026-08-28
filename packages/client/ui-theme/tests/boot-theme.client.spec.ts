// @vitest-environment jsdom
/** The theme bootstrap injection row and the resulting pre-plugin browser theme. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootThemeInjection } from '../src/boot-theme.ts'
import { PAPER_TONE_LAYERS } from '../src/paper-tones.ts'
import type { PaperTone } from '../src/paper-tones.ts'
import type { ThemePreference } from '../src/theme-settings.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Every token any paper tone may write inline; the per-test body reuse
 * demands the cleanup retract them all. */
const PAPER_TOKEN_NAMES = [...new Set(Object.values(PAPER_TONE_LAYERS).flatMap(layers => Object.keys(layers)))]

function mockSystemDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
}

function executeBootstrap(preference?: ThemePreference, paper?: PaperTone): void {
  const row = bootThemeInjection(preference, paper)
  if (row.kind !== 'script') throw new Error('theme bootstrap row is not a script')
  runInNewContext(row.text, { document, matchMedia: globalThis.matchMedia })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  for (const name of PAPER_TOKEN_NAMES) document.body.style.removeProperty(name)
})

describe('theme bootstrap row', () => {
  it('is a body script row, so it runs before the shell mount', () => {
    mockSystemDark(false)
    const row = bootThemeInjection('dark')
    expect(row).toMatchObject({ kind: 'script', placement: 'body' })
    executeBootstrap('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
  })

  it('lets durable light override a dark OS and clears stale dark state', () => {
    document.body.setAttribute(DARK_ATTRIBUTE, '')
    mockSystemDark(true)
    executeBootstrap('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it.each([
    [true, 'dark', true],
    [false, 'light', false],
  ] as const)('resolves system=%s to %s', (matches, colorScheme, dark) => {
    mockSystemDark(matches)
    executeBootstrap('system')
    expect(document.documentElement.style.colorScheme).toBe(colorScheme)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(dark)
  })

  it('defaults to system and falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    executeBootstrap()
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it('embeds the durable paper tone as inline body variables before the shell mounts', () => {
    mockSystemDark(false)
    executeBootstrap('light', 'sepia')
    expect(document.body.style.getPropertyValue('--dsw-alias-bg-base')).toBe('rgb(250, 244, 231)')
    expect(document.body.style.getPropertyValue('--dsw-specific-bubble')).toBe('rgb(243, 233, 216)')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('picks the tone\'s dark variants when the resolved scheme is dark', () => {
    mockSystemDark(true)
    executeBootstrap('system', 'sepia')
    expect(document.body.style.getPropertyValue('--dsw-alias-bg-base')).toBe('rgb(26, 23, 20)')
    expect(document.body.style.getPropertyValue('--dsw-specific-bubble')).toBe('rgb(44, 39, 33)')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('leaves no inline token writes for the default tone', () => {
    mockSystemDark(false)
    executeBootstrap('light')
    for (const name of PAPER_TOKEN_NAMES) {
      expect(document.body.style.getPropertyValue(name)).toBe('')
    }
  })
})
