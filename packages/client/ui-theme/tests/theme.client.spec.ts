// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  PaperTone,
  ThemeSettings,
  ThemeSnapshot,
  ThemeTokenOverrides,
} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'

const make = (host = stubSettingsScope<ThemeSettings>()): {
  ctx: Context
  theme: ThemeRuntime
  events: ThemeSnapshot[]
  host: StubSettingsScope<ThemeSettings>
} => {
  const ctx = new Context()
  const events: ThemeSnapshot[] = []
  ctx.on('theme/change', (snapshot) => { events.push(snapshot) })
  return { ctx, theme: new ThemeRuntime(ctx, host.scope), events, host }
}

/** Consumer-style layer contribution (the ui-paper plugin's shape). */
const SEPIA_LAYERS: Record<PaperTone, ThemeTokenOverrides> = {
  default: {},
  cream: {},
  sepia: {
    '--dsw-alias-bg-base': { light: 'rgb(250, 244, 231)', dark: 'rgb(26, 23, 20)' },
    '--dsw-specific-bubble': { light: 'rgb(243, 233, 216)', dark: 'rgb(44, 39, 33)' },
  },
  green: {},
}

const EMPTY_LAYERS: Record<PaperTone, ThemeTokenOverrides> = {
  default: {}, cream: {}, sepia: {}, green: {},
}

describe('ThemeRuntime', () => {
  it('defaults to the system preference resolved against prefers-color-scheme', () => {
    const { theme } = make()
    const snapshot = theme.getTheme()
    expect(snapshot.preference).toBe('system')
    expect(snapshot.paper).toBe('default')
    // jsdom matchMedia is absent; system resolves to light.
    expect(snapshot.active.id).toBe('light')
    expect(snapshot.active.colorScheme).toBe('light')
    expect(snapshot.themes.map(t => t.id)).toEqual(['light', 'dark'])
  })

  it('setTheme switches, writes through the scope, republishes, and keeps DOM untouched', () => {
    const { theme, events, host } = make()
    theme.setTheme('dark')
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().active.colorScheme).toBe('dark')
    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(theme.getTheme())
    // The service never touches presentation state.
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    // Same-value set is a no-op (no extra event).
    theme.setTheme('dark')
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('setPaper switches, writes through the scope, folds tone tokens, and keeps DOM untouched', () => {
    const { theme, events, host } = make()
    theme.registerPaperToneLayers(SEPIA_LAYERS)
    theme.setPaper('sepia')
    expect(theme.getTheme().paper).toBe('sepia')
    expect(host.set).toHaveBeenCalledWith('paper', 'sepia')
    // The tone folds its light variant while the light scheme is active…
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('rgb(250, 244, 231)')
    // …and its dark variant when the scheme flips — the tonal choice survives.
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('rgb(26, 23, 20)')
    expect(theme.getTheme().active.colorScheme).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    // Same-value set is a no-op (no extra event, no extra write).
    theme.setPaper('sepia')
    expect(events).toHaveLength(3)
    expect(host.set).toHaveBeenCalledTimes(2)
    expect(host.set).toHaveBeenNthCalledWith(1, 'paper', 'sepia')
    expect(host.set).toHaveBeenNthCalledWith(2, 'preference', 'dark')
  })

  it('keeps the tone inert when no layer table is contributed', () => {
    const { theme } = make()
    theme.setPaper('sepia')
    expect(theme.getTheme().paper).toBe('sepia')
    expect(theme.getTheme().active.tokens).toEqual({})
  })

  it('the paper tone beats third-party override layers', () => {
    const { theme } = make()
    theme.overrideTokens('package', {
      '--dsw-alias-bg-base': { light: 'override-light', dark: 'override-dark' },
    })
    theme.registerPaperToneLayers(SEPIA_LAYERS)
    theme.setPaper('green')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('override-light')
    theme.setPaper('sepia')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('rgb(250, 244, 231)')
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('rgb(26, 23, 20)')
  })

  it('registerPaperToneLayers swaps on re-registration and the disposer restores the inert state', () => {
    const { theme, events } = make()
    const first = theme.registerPaperToneLayers(SEPIA_LAYERS)
    theme.registerPaperToneLayers(EMPTY_LAYERS)
    // A stale disposer must not clear the newer contribution.
    first()
    theme.setPaper('sepia')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBeUndefined()
    const current = theme.registerPaperToneLayers(SEPIA_LAYERS)
    current()
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBeUndefined()
    current()
    expect(events).toHaveLength(5)
  })

  it('adopts a published Host section without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'dark', paper: 'default' }, revision: 1, writable: true })
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().paper).toBe('default')
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { preference: 'dark', paper: 'default' }, revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('adopts a Host change that moves only the paper field', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: { preference: 'dark', paper: 'default' }, revision: 1, writable: true })
    expect(theme.getTheme().preference).toBe('dark')
    host.publish({ value: { preference: 'dark', paper: 'cream' }, revision: 2 })
    expect(theme.getTheme().paper).toBe('cream')
    expect(theme.getTheme().preference).toBe('dark')
    expect(events).toHaveLength(2)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('defaults paper when adopting a wire section written before the field existed', () => {
    // The browser scope validates but does not apply schema defaults, so an
    // older document arrives without the paper key.
    const { theme, host } = make()
    host.publish({
      status: 'ready',
      value: { preference: 'dark' } as unknown as ThemeSettings,
      revision: 1,
      writable: true,
    })
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().paper).toBe('default')
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ThemeSettings>()
    host.publish({ status: 'ready', value: { preference: 'dark', paper: 'cream' }, revision: 1, writable: true })
    const { theme } = make(host)
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().paper).toBe('cream')
  })

  it('throws on unknown setTheme ids, duplicate registration, and the system id', () => {
    const { theme } = make()
    expect(() => { theme.setTheme('sepia') }).toThrow('not registered')
    expect(() => theme.register({ id: 'light', colorScheme: 'light', tokens: {} })).toThrow('already registered')
    expect(() => theme.register({ id: 'system', colorScheme: 'light', tokens: {} })).toThrow('preference')
  })

  it('registered themes join the snapshot; disposing the active one resets to default', () => {
    const { theme, events, host } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: { '--dsw-alias-bg-base': 'red' } })
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark', 'sepia'])
    theme.setTheme('sepia')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('red')
    dispose()
    expect(theme.getTheme().preference).toBe('system')
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark'])
    // Custom ids are in-process extension themes; only the built-in product
    // preferences cross the Host settings schema.
    expect(host.set).not.toHaveBeenCalled()
    // register + set + dispose = three publishes; disposer is idempotent.
    expect(events.length).toBe(3)
    dispose()
    expect(events.length).toBe(3)
  })

  it('disposing an inactive theme keeps the active preference', () => {
    const { theme } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: {} })
    theme.setTheme('dark')
    dispose()
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('revision increases monotonically across every publish', () => {
    const { theme, events } = make()
    theme.setTheme('dark')
    theme.setTheme('light')
    const dispose = theme.register({ id: 'sepia', colorScheme: 'dark', tokens: {} })
    dispose()
    expect(events.map(e => e.revision)).toEqual([1, 2, 3, 4])
  })

  it('stacks reversible token overrides in call order and selects the active palette value', () => {
    const { theme } = make()
    const firstTokens: ThemeTokenOverrides = {
      '--shared': { light: 'first-light', dark: 'first-dark' },
      '--first': { light: 'first-only-light', dark: 'first-only-dark' },
    }
    const disposeFirst = theme.overrideTokens('first', firstTokens)
    firstTokens['--shared']!.light = 'mutated-after-call'
    const disposeSecond = theme.overrideTokens('second', {
      '--shared': { light: 'second-light', dark: 'second-dark' },
    })

    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-light',
      '--shared': 'second-light',
    })
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-dark',
      '--shared': 'second-dark',
    })

    disposeSecond()
    expect(theme.getTheme().active.tokens['--shared']).toBe('first-dark')
    disposeFirst()
    expect(theme.getTheme().active.tokens['--shared']).toBeUndefined()
  })

  it('replacing one source leaves its stale disposer harmless', () => {
    const { theme, events } = make()
    const stale = theme.overrideTokens('package', {
      '--old': { light: 'old-light', dark: 'old-dark' },
    })
    const current = theme.overrideTokens('package', {
      '--new': { light: 'new-light', dark: 'new-dark' },
    })
    stale()
    expect(theme.getTheme().active.tokens).toEqual({ '--new': 'new-light' })
    current()
    current()
    expect(theme.getTheme().active.tokens).toEqual({})
    expect(events).toHaveLength(3)
  })

  it('exports sorted built-in, registered, and override-only token descriptions as copies', () => {
    const { theme } = make()
    theme.register({
      id: 'custom',
      colorScheme: 'light',
      tokens: {
        '--dsw-alias-bg-base': 'duplicate-built-in',
        '--registered': 'registered',
      },
    })
    theme.overrideTokens('package', {
      '--registered': { light: 'duplicate-registered', dark: 'duplicate-registered' },
      semanticAccent: { light: 'pink', dark: 'red' },
    })

    const tokens = theme.exportInspectTokens()
    expect(tokens.map(token => token.name)).toEqual([...tokens.map(token => token.name)].sort())
    expect(tokens.find(token => token.name === '--registered')).toMatchObject({
      valueType: 'CSS value',
      cssVariable: '--registered',
    })
    const semantic = tokens.find(token => token.name === 'semanticAccent')
    expect(semantic).toMatchObject({ valueType: 'CSS value' })
    expect(semantic).not.toHaveProperty('cssVariable')
    expect(tokens.filter(token => token.name === '--dsw-alias-bg-base')).toHaveLength(1)

    tokens[0]!.description = 'caller mutation'
    expect(theme.exportInspectTokens()[0]!.description).not.toBe('caller mutation')
  })

  it('includes contributed paper-layer token names in the inspect directory once', () => {
    const { theme } = make()
    const tokens = theme.exportInspectTokens()
    expect(tokens.find(token => token.name === '--dsw-specific-bubble')).toBeUndefined()
    theme.registerPaperToneLayers(SEPIA_LAYERS)
    const after = theme.exportInspectTokens()
    expect(after.find(token => token.name === '--dsw-specific-bubble')).toMatchObject({
      valueType: 'CSS value',
      cssVariable: '--dsw-specific-bubble',
    })
    expect(after.filter(token => token.name === '--dsw-specific-bubble')).toHaveLength(1)
  })

  it('rejects every malformed token override value with a teaching error', () => {
    const { theme } = make()
    const override = (value: unknown): void => {
      theme.overrideTokens('package', { '--bad': value } as unknown as ThemeTokenOverrides)
    }
    expect(() => { override('red') }).toThrow(/bare string.*light.*dark/)
    for (const value of [1, null, {}, { light: 1, dark: 'dark' }, { light: 'light' }]) {
      expect(() => { override(value) }).toThrow(/must map to a \{ light, dark \} pair/)
    }
  })

  it('context dispose releases the scope subscription', async () => {
    const { ctx, host } = make()
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  describe('prefers-color-scheme resolution (stubbed matchMedia)', () => {
    type Listener = () => void
    const stubMedia = (initialMatches: boolean) => {
      const listeners = new Set<Listener>()
      const media = {
        matches: initialMatches,
        addEventListener: (_: 'change', fn: Listener) => { listeners.add(fn) },
        removeEventListener: (_: 'change', fn: Listener) => { listeners.delete(fn) },
        flip() {
          this.matches = !this.matches
          for (const fn of listeners) fn()
        },
        listenerCount: () => listeners.size,
      }
      vi.stubGlobal('matchMedia', () => media)
      return media
    }

    afterEach(() => { vi.unstubAllGlobals() })

    it('system resolves against the media query and follows OS flips', () => {
      const media = stubMedia(true)
      const { theme, events } = make()
      expect(theme.getTheme().preference).toBe('system')
      expect(theme.getTheme().active.id).toBe('dark')
      media.flip()
      expect(theme.getTheme().active.id).toBe('light')
      expect(events).toHaveLength(1)
    })

    it('OS flips do not republish while a concrete preference is set', () => {
      const media = stubMedia(false)
      const { theme, events } = make()
      theme.setTheme('light')
      expect(events).toHaveLength(1)
      media.flip()
      expect(events).toHaveLength(1)
      expect(theme.getTheme().active.id).toBe('light')
    })

    it('context dispose releases the media listener', async () => {
      const media = stubMedia(false)
      const { ctx } = make()
      expect(media.listenerCount()).toBe(1)
      await ctx.fiber.dispose()
      expect(media.listenerCount()).toBe(0)
    })
  })
})
