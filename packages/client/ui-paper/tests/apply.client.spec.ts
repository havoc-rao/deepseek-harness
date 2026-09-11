// @vitest-environment jsdom
/** ui-paper client apply over the real theme service: the active tone's
 * layer folds into the composed snapshot, the settings row registers with
 * its own copy, the store mirrors the tone, face writes route back through
 * the durable scope, and teardown clears the layer (HMR collapse keeps the
 * service inert). */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as themeApply, inject as themeInject } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, SETTINGS_NS } from '@deepseek-ai/dsh-client-ui-paper/client'
import type { PaperRowInjected, PaperSettings } from '@deepseek-ai/dsh-client-ui-paper/client'
import { PaperToneRow } from '../src/client/PaperToneRow.tsx'
import type { createPaperRowStore } from '../src/client/settings-store.ts'

const SLOT = 'settings.general.item'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  // Model the bench as a remote, memory-only browser; each bound namespace
  // (theme's and paper's) gets its own stub so a section settling for one
  // plugin never feeds the other.
  const stubs = new Map<string, StubSettingsScope<never>>()
  const stubFor = (namespace: string): StubSettingsScope<never> => {
    let stub = stubs.get(namespace)
    if (stub === undefined) {
      stub = stubSettingsScope()
      stubs.set(namespace, stub)
    }
    return stub
  }
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', {
    bind: (spec: { namespace: string }) => stubFor(spec.namespace).scope,
  } as never)
  await ctx.plugin({ inject: themeInject, apply: themeApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale,
    // Seeded eagerly so tests can drive the paper section around plugin start.
    paperStub: stubFor('ui-paper') as StubSettingsScope<PaperSettings>,
  }
}

/** Stand in for the settings shell: declare the General item slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === PaperToneRow)!
  const handle = entry.store as ReturnType<typeof createPaperRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => PaperRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-paper client apply', () => {
  it('declares the theme service alongside slots, locale, and the settings transport', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme', 'remote', 'settingsScope'])
  })

  it('applies the tone layer, registers the row, and folds the tone into the snapshot', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // The contribution is live: the durable write routes through the scope,
    // and the settled section's tone re-contributes the layer.
    const { face } = faceOf(b.slots)
    face.setPaper('sepia')
    expect(b.paperStub.set).toHaveBeenCalledWith('tone', 'sepia')
    b.paperStub.publish({ status: 'ready', value: { tone: 'sepia' } })
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('rgb(250, 244, 231)')
    // The row registered with its own locale seat and copy.
    const entry = b.slots.entries(SLOT).find(e => e.component === PaperToneRow)!
    expect(entry.options).toMatchObject({ id: 'paper-tone', order: 12 })
    expect(entry.locale).toBe(SETTINGS_NS)
    expect(b.locale.bind(SETTINGS_NS)('paper.title')).toBe('纸面色调')
    await fiber.dispose()
  })

  it('the store mirrors the tone and follows the settled section', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const { instance, face } = faceOf(b.slots)
    // Inject-time re-sync sealed the mirror; the plugin's first adoption landed.
    expect(instance.getSnapshot().paper).toBe('default')
    face.setPaper('cream')
    b.paperStub.publish({ status: 'ready', value: { tone: 'cream' } })
    expect(instance.getSnapshot().paper).toBe('cream')
    await fiber.dispose()
  })

  it('teardown clears the layer and the row, leaving the service inert', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    const { face } = faceOf(b.slots)
    face.setPaper('sepia')
    b.paperStub.publish({ status: 'ready', value: { tone: 'sepia' } })
    expect(b.slots.entries(SLOT).some(e => e.component === PaperToneRow)).toBe(true)
    await fiber.dispose()
    expect(b.slots.entries(SLOT).some(e => e.component === PaperToneRow)).toBe(false)
    // The HMR collapse restored the unregistered state: the persisted tone
    // no longer tints anything, and the theme service stays healthy.
    expect(theme.getTheme().active.tokens).toEqual({})
  })

  it('recovers after an HMR collapse of the declaring entry', async () => {
    const b = await bench()
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT).some(e => e.component === PaperToneRow)).toBe(true)
    host()
    expect(b.slots.entries(SLOT).some(e => e.component === PaperToneRow)).toBe(false)
    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === PaperToneRow)).toBe(true)
  })
})
