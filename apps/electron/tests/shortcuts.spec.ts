/**
 * Unit tests for the shortcut router (apps/electron/src/shortcuts.ts). Pure
 * main-process logic without an Electron runtime.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createShortcutRouter,
  type DesktopShortcut,
  type DesktopShortcutHandler,
} from '../src/shortcuts.ts'

describe('createShortcutRouter', () => {
  it('routes to unclaimed when no handler is registered', async () => {
    const router = createShortcutRouter()
    await expect(router.route('cmd-w')).resolves.toBe('unclaimed')
  })

  it('passes the press to each registered handler with the shortcut name', async () => {
    const router = createShortcutRouter()
    const seen: DesktopShortcut[] = []
    router.register('cmd-w', (shortcut) => { seen.push(shortcut) })
    await router.route('cmd-w')
    expect(seen).toEqual(['cmd-w'])
  })

  it('stops at the first claiming handler', async () => {
    const router = createShortcutRouter()
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    router.register('cmd-w', first)
    router.register('cmd-w', second)
    await expect(router.route('cmd-w')).resolves.toBe('claimed')
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('passes to the next handler when a handler declines', async () => {
    const router = createShortcutRouter()
    const calls: string[] = []
    router.register('cmd-w', () => { calls.push('first'); return false })
    router.register('cmd-w', () => { calls.push('second') })
    router.register('cmd-w', () => { calls.push('third'); return true })
    await expect(router.route('cmd-w')).resolves.toBe('claimed')
    expect(calls).toEqual(['first', 'second', 'third'])
  })

  it('awaits an async handler before deciding', async () => {
    const router = createShortcutRouter()
    router.register('cmd-w', async () => true)
    await expect(router.route('cmd-w')).resolves.toBe('claimed')
  })

  it('resolves unclaimed when every handler declines', async () => {
    const router = createShortcutRouter()
    router.register('cmd-w', () => false)
    router.register('cmd-w', () => undefined)
    await expect(router.route('cmd-w')).resolves.toBe('unclaimed')
  })

  it('disposes exactly the registration it returned', async () => {
    const router = createShortcutRouter()
    const claim: DesktopShortcutHandler = () => true
    const drop = router.register('cmd-w', claim)
    router.register('cmd-w', claim)
    drop()
    drop()
    await expect(router.route('cmd-w')).resolves.toBe('claimed')
  })

  it('rejects when a handler throws, so the caller falls back', async () => {
    const router = createShortcutRouter()
    router.register('cmd-w', () => { throw new Error('boom') })
    await expect(router.route('cmd-w')).rejects.toThrow('boom')
  })
})
