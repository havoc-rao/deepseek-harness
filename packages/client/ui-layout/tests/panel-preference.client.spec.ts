// @vitest-environment jsdom
/** The width preference bridge: adoption, commit points, echo guards, and
 * pre-load pending flush, against a real layout store and a stubbed scope. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { LayoutSettings } from '../src/layout-settings.ts'
import { createLayoutStore } from '../src/client/stores.ts'
import { RightbarPreferenceSync } from '../src/client/panel-preference.ts'

type LayoutStoreFactory = typeof createLayoutStore
type LayoutInstance = ReturnType<ReturnType<LayoutStoreFactory>['create']>

let instance: LayoutInstance

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1920)
  instance = createLayoutStore().create()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RightbarPreferenceSync', () => {
  it('adopts a stored width once the section is ready, clamped like a drag', () => {
    const host = stubSettingsScope<LayoutSettings>()
    const sync = new RightbarPreferenceSync(instance, host.scope)
    host.publish({ status: 'ready', value: { rightbar: 420 }, writable: true })
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(420)
    expect(host.set).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('keeps the derived rule while the section holds no width', () => {
    const host = stubSettingsScope<LayoutSettings>()
    const sync = new RightbarPreferenceSync(instance, host.scope)
    host.publish({ status: 'ready', value: { rightbar: null }, writable: true })
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(null)
    sync.dispose()
  })

  it('never clobbers a preference the user already set before the section loaded', () => {
    const host = stubSettingsScope<LayoutSettings>()
    instance.actions.setRightbar(500)
    const sync = new RightbarPreferenceSync(instance, host.scope)
    host.publish({ status: 'ready', value: { rightbar: 420 }, writable: true })
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(500)
    sync.dispose()
  })

  it('persists the width at a finished drag and never mid-gesture', () => {
    const host = stubSettingsScope<LayoutSettings>()
    host.publish({ status: 'ready', value: { rightbar: null }, writable: true })
    const sync = new RightbarPreferenceSync(instance, host.scope)
    // The first open materializes and persists the derived width (one write).
    instance.actions.openRightbar(true, false)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(864)
    expect(host.set).toHaveBeenCalledWith('rightbar', 864)
    // Mid-gesture writes commit nothing by themselves.
    instance.actions.setRightbar(500)
    instance.actions.setRightbar(600)
    expect(host.set).toHaveBeenCalledTimes(1)
    sync.commit()
    expect(host.set).toHaveBeenCalledWith('rightbar', 600)
    expect(host.set).toHaveBeenCalledTimes(2)
    // A release at the same width is not another write.
    instance.actions.setRightbar(600)
    sync.commit()
    expect(host.set).toHaveBeenCalledTimes(2)
    sync.dispose()
  })

  it('persists the first materialization as the commit of the derived width', () => {
    const host = stubSettingsScope<LayoutSettings>()
    host.publish({ status: 'ready', value: { rightbar: null }, writable: true })
    const sync = new RightbarPreferenceSync(instance, host.scope)
    instance.actions.openRightbar(true, false)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(864)
    expect(host.set).toHaveBeenCalledWith('rightbar', 864)
    sync.dispose()
  })

  it('does not echo an adopted width back to the section', () => {
    const host = stubSettingsScope<LayoutSettings>()
    host.publish({ status: 'ready', value: { rightbar: 420 }, writable: true })
    const sync = new RightbarPreferenceSync(instance, host.scope)
    expect(host.set).not.toHaveBeenCalled()
    // Further activity at the adopted width stays silent too.
    instance.actions.openRightbar(true, false)
    expect(host.set).not.toHaveBeenCalled()
    sync.dispose()
  })

  it('flushes a width committed while the section is still loading', () => {
    const host = stubSettingsScope<LayoutSettings>()
    const sync = new RightbarPreferenceSync(instance, host.scope)
    instance.actions.setRightbar(500)
    sync.commit()
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ status: 'ready', value: { rightbar: null }, writable: true })
    expect(host.set).toHaveBeenCalledWith('rightbar', 500)
    sync.dispose()
  })

  it('stays process-local and silent without a scope', () => {
    const sync = new RightbarPreferenceSync(instance, undefined)
    instance.actions.setRightbar(500)
    sync.commit()
    instance.actions.openRightbar(true, false)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(500)
    sync.dispose()
  })

  it('unsubscribes both directions on dispose', () => {
    const host = stubSettingsScope<LayoutSettings>()
    const sync = new RightbarPreferenceSync(instance, host.scope)
    sync.dispose()
    expect(host.listenerCount()).toBe(0)
    // Post-dispose activity reaches nothing: no adoption, no persistence.
    instance.actions.setRightbar(700)
    sync.commit()
    instance.actions.openRightbar(true, false)
    expect(host.set).not.toHaveBeenCalled()
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(700)
  })
})
