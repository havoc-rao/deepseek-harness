// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { buildInjected, LOCALE_NS } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(() => {})

// The face reads its initial locale from the browser; this spec asserts the
// shipped Chinese copy, so it states the browser it assumes.
usePinnedBrowserLanguages('zh-CN')

const HOLES = [
  'sidebar.workspaces.workspaceIcon',
  'sidebar.workspaces.workspaceMenu',
  'sidebar.workspaces.workspaceHoverIcon',
] as const

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('workspaces', {
    setLogo: vi.fn(async () => ({
      workspaceId: 'w', path: '/', title: 'w', sessionIds: [], createdAt: 't', updatedAt: 't',
    })),
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  // The real declaration chain reaches the row holes through root -> sidebar
  // -> sidebar.workspaces; the bench rebuilds it so register() sees declared
  // targets (root itself is built in).
  const declare = () => {
    const disposers = [
      slots.register({ name: 'root', children: { sidebar: { kind: 'single', scope: 'root' } } } as never, () => null),
      slots.register({ name: 'sidebar', children: { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } } as never, () => null),
      slots.register({
        name: 'sidebar.workspaces',
        children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
      } as never, () => null),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }
  return { ctx, slots, declare }
}

describe('workspace-logo plugin', () => {
  it('registers the three row-hole occupants with the declarations and empties the holes on disposal', async () => {
    const before = await bench()
    before.declare()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)
    // Registry-contribution disposal proof: the fiber going down empties the holes.
    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    // Declaration-lifetime independence: with no declaration the occupants
    // stay out, and a later declaration fills the holes reactively.
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('inject face binds the locale seat and commits picks through the Host', async () => {
    const setLogo = vi.fn(async () => ({
      workspaceId: 'w', path: '/', title: 'w', sessionIds: [], createdAt: 't', updatedAt: 't',
    }))
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('workspaces', { setLogo } as never)
    ctx.locale.register(LOCALE_NS, { zh, en })
    const face = buildInjected(ctx as never)
    expect(face.t('menu.addLogo')).toBe('添加 logo 图片')
    await face.pick('w' as never, 'data:image/png;base64,abc')
    expect(setLogo).toHaveBeenCalledWith('w', 'data:image/png;base64,abc')

    // Rejection is a non-fatal console diagnostic.
    const failingCtx = new Context()
    await failingCtx.plugin(SlotRegistry).await()
    failingCtx.provide('locale', new LocaleRuntime(failingCtx))
    failingCtx.provide('workspaces', {
      setLogo: vi.fn(async () => { throw new Error('host rejected') }),
    } as never)
    const failing = buildInjected(failingCtx as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await failing.pick('w' as never, 'data:image/png;base64,abc')
      expect(warn).toHaveBeenCalledWith('workspace logo set rejected:', expect.any(Error))
    } finally {
      warn.mockRestore()
    }
    expect(LOCALE_NS).toBe('workspace-logo')
  })

  it('node-half apply is a no-op host placeholder', () => {
    nodeApply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
