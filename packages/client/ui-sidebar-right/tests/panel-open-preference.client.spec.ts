// @vitest-environment jsdom
/** The panel open-state preference: which gestures persist, what restores,
 * and why the responsive close never reaches the durable section. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import type { PanelSettings } from '../src/panel-settings.ts'
import { createSidebarRightStore, GLOBAL_SURFACE_KEY } from '../src/client/stores.ts'
import { PanelOpenPreference } from '../src/client/panel-open-preference.ts'
import type { SidebarRightSeed } from '../src/client/contract/seed.ts'

const SESSION = 's-test' as SessionId
const seed = (): SidebarRightSeed => ({ kind: 'guide', title: 'Guide' })

function store() {
  return createSidebarRightStore(seed).create(SESSION)
}

function ready(expanded: boolean | null) {
  const host = stubSettingsScope<PanelSettings>()
  host.publish({ status: 'ready', value: { rightbarExpanded: expanded }, writable: true })
  return host
}

describe('PanelOpenPreference', () => {
  it('persists a strip toggle, an explicit expand, and an open, but never an auto-close', () => {
    const host = ready(null)
    const sync = new PanelOpenPreference(host.scope)
    const instance = sync.wrap(store(), SESSION)
    instance.actions.open(SESSION)
    // The responsive auto-close setExpanded(false) is not a user choice.
    instance.actions.setExpanded(SESSION, false)
    expect(host.set).not.toHaveBeenCalled()
    instance.actions.toggleExpanded(SESSION)
    expect(host.set).toHaveBeenLastCalledWith('rightbarExpanded', true)
    instance.actions.toggleExpanded(SESSION)
    expect(host.set).toHaveBeenLastCalledWith('rightbarExpanded', false)
    instance.actions.setExpanded(SESSION, false)
    // A next open persists again after the durable value moved.
    instance.actions.openContent(SESSION, { kind: 'guide', contentId: 'sidebar://guide', title: 'Guide' }, () => {})
    expect(host.set).toHaveBeenLastCalledWith('rightbarExpanded', true)
    expect(host.set).toHaveBeenCalledTimes(3)
    // A redundant open (the durable choice already says open) stays silent;
    // the responsive close after it stays silent too.
    const before = host.set.mock.calls.length
    instance.actions.openContent(SESSION, { kind: 'guide', contentId: 'sidebar://guide', title: 'Guide' }, () => {})
    instance.actions.setExpanded(SESSION, false)
    expect(host.set.mock.calls.length).toBe(before)
    sync.dispose()
  })

  it('flushes a gesture committed before the section is ready, and never echoes a restore', () => {
    const host = stubSettingsScope<PanelSettings>()
    const sync = new PanelOpenPreference(host.scope)
    const instance = sync.wrap(store(), SESSION)
    instance.actions.open(SESSION)
    instance.actions.toggleExpanded(SESSION)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ status: 'ready', value: { rightbarExpanded: null }, writable: true })
    expect(host.set).toHaveBeenLastCalledWith('rightbarExpanded', true)
    expect(host.set).toHaveBeenCalledTimes(1)
    sync.dispose()
  })

  it('reopens the column where the user left it once the section loads', () => {
    const instance = store()
    instance.actions.open(SESSION)
    const host = stubSettingsScope<PanelSettings>()
    const sync = new PanelOpenPreference(host.scope)
    sync.wrap(instance, SESSION)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(false)
    host.publish({ status: 'ready', value: { rightbarExpanded: true }, writable: true })
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(true)
    expect(host.set).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('restores the boot surface materialized after the section loaded, and honors a user action', () => {
    const host = stubSettingsScope<PanelSettings>()
    const sync = new PanelOpenPreference(host.scope)
    // The wrapped instance is the one gestures must run through: only it
    // marks the surface touched.
    const instance = sync.wrap(store(), SESSION)
    // The section arrives before the seat opens the surface on session switch.
    host.publish({ status: 'ready', value: { rightbarExpanded: true }, writable: true })
    expect(instance.getSnapshot().bySession[SESSION]).toBeUndefined()
    instance.actions.open(SESSION)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(true)
    // A touched surface is never rewound: collapse after the load stays put.
    instance.actions.toggleExpanded(SESSION)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(false)
    expect(host.set).toHaveBeenLastCalledWith('rightbarExpanded', false)
    instance.actions.open(SESSION)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(false)
    sync.dispose()
  })

  it('restores only the boot surface; later surfaces start collapsed on their own', () => {
    const host = stubSettingsScope<PanelSettings>()
    const sync = new PanelOpenPreference(host.scope)
    const instance = sync.wrap(store(), SESSION)
    instance.actions.open(SESSION)
    host.publish({ status: 'ready', value: { rightbarExpanded: true }, writable: true })
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(true)
    // A new Session's surface materializes after the restore was spent: the
    // column choice belongs to the surface the user was on, never to a fresh
    // session's independent surface.
    const other = sync.wrap(store(), 's-other' as SessionId)
    other.actions.open('s-other')
    expect(other.getSnapshot().bySession['s-other' as SessionId]?.layout.expanded).toBe(false)
    sync.dispose()
  })

  it('keeps the column collapsed while the section holds no explicit choice', () => {
    for (const expanded of [null, false]) {
      const instance = store()
      instance.actions.open(SESSION)
      const host = ready(expanded)
      const sync = new PanelOpenPreference(host.scope)
      sync.wrap(instance, SESSION)
      expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(false)
      expect(host.set).not.toHaveBeenCalled()
      sync.dispose()
    }
  })

  it('wraps the session-independent surface like any other', () => {
    const host = ready(null)
    const sync = new PanelOpenPreference(host.scope)
    const bare = createSidebarRightStore(seed).create(undefined)
    const instance = sync.wrap(bare, GLOBAL_SURFACE_KEY)
    instance.actions.open(GLOBAL_SURFACE_KEY)
    instance.actions.toggleExpanded(GLOBAL_SURFACE_KEY)
    expect(instance.getSnapshot().bySession[GLOBAL_SURFACE_KEY]?.layout.expanded).toBe(true)
    expect(host.set).toHaveBeenLastCalledWith('rightbarExpanded', true)
    sync.dispose()
  })

  it('never restores the session-independent surface, so a boot that selects a Session keeps its restore', () => {
    const host = stubSettingsScope<PanelSettings>()
    const sync = new PanelOpenPreference(host.scope)
    const bare = createSidebarRightStore(seed).create(undefined)
    const global = sync.wrap(bare, GLOBAL_SURFACE_KEY)
    // The app boots session-less while the connection settles: the reserved
    // surface materializes first and must not spend the restore.
    global.actions.open(GLOBAL_SURFACE_KEY)
    host.publish({ status: 'ready', value: { rightbarExpanded: true }, writable: true })
    expect(global.getSnapshot().bySession[GLOBAL_SURFACE_KEY]?.layout.expanded).toBe(false)
    // The Session that follows still reopens where the user left it.
    const session = sync.wrap(store(), SESSION)
    session.actions.open(SESSION)
    expect(session.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(true)
    sync.dispose()
  })

  it('stays process-local and silent without a scope', () => {
    const sync = new PanelOpenPreference(undefined)
    const instance = sync.wrap(store(), SESSION)
    instance.actions.open(SESSION)
    instance.actions.toggleExpanded(SESSION)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(true)
    sync.dispose()
  })

  it('releases every subscription on dispose', () => {
    const host = ready(null)
    const sync = new PanelOpenPreference(host.scope)
    const instance = sync.wrap(store(), SESSION)
    sync.dispose()
    expect(host.listenerCount()).toBe(0)
    instance.actions.open(SESSION)
    instance.actions.toggleExpanded(SESSION)
    expect(host.set).not.toHaveBeenCalled()
  })
})
