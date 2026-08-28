// @vitest-environment jsdom
/** The paper-tone bootstrap row: embeds one tone's per-scheme variants and
 * picks them by the resolved scheme before the shell mounts. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paperBootInjection } from '../src/boot-paper.ts'
import { PAPER_TONE_LAYERS } from '../src/paper-tones.ts'
import type { PaperTone } from '@deepseek-ai/dsh-client-ui-theme'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme'

/** Every token any paper tone may write inline; the per-test body reuse
 * demands the cleanup retract them all. */
const PAPER_TOKEN_NAMES = [...new Set(Object.values(PAPER_TONE_LAYERS).flatMap(layers => Object.keys(layers)))]

function executeBootstrap(preference: ThemePreference, paper: PaperTone): void {
  const row = paperBootInjection(preference, paper)
  if (row.kind !== 'script') throw new Error('paper bootstrap row is not a script')
  runInNewContext(row.text, { document, matchMedia: globalThis.matchMedia })
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute('data-ds-dark-theme')
  for (const name of PAPER_TOKEN_NAMES) document.body.style.removeProperty(name)
})

describe('paper bootstrap row', () => {
  it('is a body script row embedding the tone tokens and picking the light variants', () => {
    const row = paperBootInjection('light', 'sepia')
    expect(row).toMatchObject({ kind: 'script', placement: 'body' })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as MediaQueryList))
    executeBootstrap('light', 'sepia')
    expect(document.body.style.getPropertyValue('--dsw-alias-bg-base')).toBe('rgb(250, 244, 231)')
    expect(document.body.style.getPropertyValue('--dsw-specific-bubble')).toBe('rgb(243, 233, 216)')
  })

  it('picks the dark variants when the resolved scheme is dark', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true }) as MediaQueryList))
    executeBootstrap('system', 'sepia')
    expect(document.body.style.getPropertyValue('--dsw-alias-bg-base')).toBe('rgb(26, 23, 20)')
    expect(document.body.style.getPropertyValue('--dsw-specific-bubble')).toBe('rgb(44, 39, 33)')
  })

  it('leaves no inline token writes for the default tone', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false }) as MediaQueryList))
    executeBootstrap('light', 'default')
    for (const name of PAPER_TOKEN_NAMES) {
      expect(document.body.style.getPropertyValue(name)).toBe('')
    }
  })
})
