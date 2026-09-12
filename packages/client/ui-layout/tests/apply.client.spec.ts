// @vitest-environment jsdom

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { stubSettingsScope, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SlotRendererHost } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply as themeApply, inject as themeInject, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply, inject, LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import { apply as nodeApply } from '@deepseek-ai/dsh-client-ui-layout'
import type { MainPanelId } from '../src/client/service.ts'
import type { createLayoutStore } from '../src/client/stores.ts'
import { LAYOUT_SETTINGS_NAMESPACE, LayoutSettingsSchema } from '../src/layout-settings.ts'
import type { FrameInjected } from '../src/client/AppFrame.tsx'
import { RightPanelWidthRow, type RightPanelWidthRowInjected } from '../src/client/settings/RightPanelWidthRow.tsx'

const owners = new Set<Fiber>()
let originalRootStyle: string | null
let originalBodyStyle: string | null
let originalDarkTheme: string | null
let originalThemeMetadata: Element[]

beforeEach(() => {
  originalRootStyle = document.documentElement.getAttribute('style')
  originalBodyStyle = document.body.getAttribute('style')
  originalDarkTheme = document.body.getAttribute('data-ds-dark-theme')
  originalThemeMetadata = [...document.head.querySelectorAll('meta[name="theme-color"]')]
  originalThemeMetadata.forEach((node) => { node.remove() })
  vi.stubGlobal('innerWidth', 1920)
})

afterEach(async () => {
  try {
    for (const owner of owners) await owner.dispose()
  } finally {
    owners.clear()
    restoreAttribute(document.documentElement, 'style', originalRootStyle)
    restoreAttribute(document.body, 'style', originalBodyStyle)
    restoreAttribute(document.body, 'data-ds-dark-theme', originalDarkTheme)
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((node) => { node.remove() })
    document.head.append(...originalThemeMetadata)
    vi.unstubAllGlobals()
  }
})

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

async function bench() {
  const root = new Context()
  let ctx: Context | undefined
  const owner = root.plugin((ownedContext: Context) => { ctx = ownedContext })
  owners.add(owner)
  await owner.await()
  if (ctx === undefined) throw new Error('the fixture owner did not activate')
  const slotsFiber = ctx.plugin(SlotRegistry)
  // Theme registers its Appearance settings row and requires the connection
  // seam for persistence; model this bench as a remote, memory-only browser.
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  // ui-theme's Appearance row binds a durable scope through these two.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: themeInject, apply: themeApply }).await()
  await slotsFiber.await()
  const slots = ctx.get('slots') as SlotRegistry
  let host: SlotRendererHost | undefined
  slots.install({ renderRoot: (value) => { host = value; return null } })
  const rendererHost = (): SlotRendererHost => {
    slots.renderSlot('root', {})
    if (host === undefined) throw new Error('the root renderer did not receive its host')
    return host
  }
  return { ctx, slots, rendererHost }
}

describe('ui-layout client apply', () => {
  it('declares its service dependencies', () => {
    expect(inject).toEqual(['slots', 'theme', 'locale', 'settingsScope'])
  })

  it('provides ctx.layout and declares the four root-scoped frame slots', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.get('layout')).toBeInstanceOf(LayoutController)
    expect(slots.entries('root')).toHaveLength(1)
    expect(slots.spec('sidebar')).toEqual({ kind: 'single', scope: 'root' })
    expect(slots.spec('main')).toEqual({ kind: 'keyed', scope: 'root' })
    expect(slots.spec('rightbar')).toEqual({ kind: 'single', scope: 'root' })
    expect(slots.spec('shell.overlay')).toEqual({ kind: 'list', scope: 'root' })
  })

  it('shares a pre-created instance between service actions, root rendering, and panelInfo', async () => {
    const { ctx, slots, rendererHost } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('root')[0]!
    expect(entry.inject).toBeDefined()
    const handle = entry.store as ReturnType<typeof createLayoutStore>
    const instance = handle.create()
    expect(handle.create()).toBe(instance)
    const layout = ctx.get('layout') as LayoutController
    expect(() => { layout.selectPanel('missing' as MainPanelId) }).toThrow('main panel "missing" is not registered')
    layout.toggleSidebar()
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
    const host = rendererHost()
    expect(host.storeOf(entry, undefined)).toBe(instance)
    const panelInfo = host.root.getSnapshot().hooks.panelInfo!
    expect(panelInfo.getSnapshot()).toBe(instance.getSnapshot().panelInfo)
    const panelId = 'panel-a' as MainPanelId
    const disposePanel = slots.register({ name: 'main', key: panelId }, () => null)
    layout.selectPanel(panelId)
    expect(panelInfo.getSnapshot()).toEqual({ activePanelId: panelId })
    disposePanel()
    await vi.waitFor(() => { expect(panelInfo.getSnapshot()).toEqual({ activePanelId: null }) })
    expect(() => { layout.selectPanel(panelId) }).toThrow('main panel "panel-a" is not registered')
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
    const pending = layout.beginNavigation()
    await fiber.dispose()
    expect(pending.aborted).toBe(true)
  })

  it('theme presenter applies the initial snapshot, follows theme/change, and unwinds on dispose', async () => {
    const { ctx } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    // Initial getter application: jsdom has no matchMedia, system resolves light.
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    const themeColorMeta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    expect(themeColorMeta).not.toBeNull()
    const theme = ctx.get('theme') as ThemeRuntime
    theme.setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.head.querySelector('meta[name="theme-color"]')).toBe(themeColorMeta)
    await fiber.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(themeColorMeta?.isConnected).toBe(false)
    // Listener is off: further theme changes no longer reach the document.
    theme.setTheme('light')
    theme.setTheme('dark')
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
  })

  it('teardown unwinds the service, the root registration, and the child declarations', async () => {
    const { ctx, slots, rendererHost } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const host = rendererHost()
    expect(host.root.getSnapshot().hooks.panelInfo).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('layout')).toBeUndefined()
    expect(slots.entries('root')).toHaveLength(0)
    expect(slots.spec('sidebar')).toBeUndefined()
    expect(slots.spec('main')).toBeUndefined()
    expect(slots.spec('rightbar')).toBeUndefined()
    expect(slots.spec('shell.overlay')).toBeUndefined()
    expect(host.root.getSnapshot().hooks.panelInfo).toBeUndefined()
    // The built-in root declaration survives entry teardown (renderer-owned).
    expect(slots.spec('root')).toEqual({ kind: 'single', scope: 'root' })
  })
})

describe('ui-layout durable preference composition', () => {
  /** Boot the real settings domain: locale, slots, TestRemote transport, the
   * settings base plugin, theme (a sibling settingsScope consumer), and the
   * layout plugin, with the General item slot declared. */
  async function bench(section: Record<string, unknown>, isLoopback = true) {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const namespace = () => ({
      ns: LAYOUT_SETTINGS_NAMESPACE,
      schema: LayoutSettingsSchema.toJSON(),
      value: { ...section },
      applies: 'live' as const,
      secrets: [],
      revision: 0,
    })
    const describe = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    }))
    const mutate = vi.fn((_ns: string, ops: { path: string[]; value: unknown }[]) => {
      const op = ops[0]!
      section[op.path[0]!] = op.value
      return Promise.resolve({ ok: true as const, value: namespace() })
    })
    const events = new TestRemote(ctx, { settings: { describe, mutate } })
    events.$host = { home: undefined, isLoopback }
    await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
    const slots = ctx.get('slots') as SlotRegistry
    // The real AppFrame owns root at priority 0; a shadow root entry declares
    // the General item slot the way ui-settings-general's General section does
    // in production (entries never render at a shadow priority).
    const declare = slots.register(
      { name: 'root', priority: 1, children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    await ctx.plugin({ inject: [...themeInject], apply: themeApply }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    return { ctx, slots, locale, describe, mutate, events, fiber, declare }
  }

  const rowOf = (slots: SlotRegistry) =>
    slots.entries('settings.general.item').find(e => e.component === RightPanelWidthRow)!
  const rootOf = (slots: SlotRegistry) => {
    const handle = slots.entries('root')[0]!.store as ReturnType<typeof createLayoutStore>
    return handle.create()
  }
  /** The frame's registrant-private face, as the renderer would bind it. */
  const frameFaceOf = (slots: SlotRegistry) =>
    (slots.entries('root')[0]!.inject as unknown as () => FrameInjected)()

  it('registers the width row and adopts the stored width from the Host document', async () => {
    const b = await bench({ rightbar: 420 })
    const entry = rowOf(b.slots)
    expect(entry.options).toMatchObject({ id: 'right-panel-width', order: 30 })
    expect(entry.locale).toBe('settings.layout')
    expect(b.locale.bind('settings.layout')('rightPanelWidth.title')).toBe('右侧栏宽度')
    const instance = rootOf(b.slots)
    await vi.waitFor(() => { expect(instance.getSnapshot().layoutInfo.rightbar).toBe(420) })
    // The row's own mirror follows the adopted value through its inject-time
    // sync, and the adoption never echoed back to the Host document.
    const rowHandle = entry.store as ReturnType<typeof import('../src/client/settings/right-panel-width-store.ts')['createRightPanelWidthRowStore']>
    const rowInstance = rowHandle.create()
    ;(entry.inject as unknown as (a: typeof rowInstance.actions) => RightPanelWidthRowInjected)(rowInstance.actions)
    expect(rowInstance.getSnapshot().width).toBe(420)
    expect(b.mutate).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('persists the committed width through a Host write at the drag release', async () => {
    const section: Record<string, unknown> = {}
    const b = await bench(section)
    const face = frameFaceOf(b.slots)
    const instance = rootOf(b.slots)
    instance.actions.setRightbar(500)
    face.persistRightbar()
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalled() })
    expect(b.mutate.mock.calls.at(-1)![1]).toContainEqual({ op: 'set', path: ['rightbar'], value: 500 })
    await b.fiber.dispose()
    b.declare()
    // The width survives a refresh: a fresh composition reads the same Host
    // document (which the commit wrote) back into a new instance.
    const fresh = await bench(section)
    const freshInstance = rootOf(fresh.slots)
    await vi.waitFor(() => { expect(freshInstance.getSnapshot().layoutInfo.rightbar).toBe(500) })
    expect(fresh.mutate).not.toHaveBeenCalled()
    await fresh.fiber.dispose()
  })

  it('keeps remote browser pages process-local', async () => {
    const b = await bench({ rightbar: 420 }, false)
    const instance = rootOf(b.slots)
    await Promise.resolve()
    // No describe read, no adoption, and a commit writes nothing.
    expect(b.describe).not.toHaveBeenCalled()
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(null)
    const face = frameFaceOf(b.slots)
    instance.actions.setRightbar(500)
    face.persistRightbar()
    await Promise.resolve()
    expect(b.mutate).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })
})

describe('node half', () => {
  it('node apply activates without a settings provider (inject stays pending)', () => {
    // A bare context has no settings provider: the inject stays pending and
    // the load must still go through without throwing. The host spec covers
    // the actual registration against a real provider.
    nodeApply(new Context())
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
