/**
 * Unit tests for the renderer shortcut bridge
 * (apps/electron/src/renderer-shortcuts.ts). Pure main-process logic without
 * an Electron runtime: the window, its webContents, and the claim channel
 * arrive as fakes, so the timeout and lifecycle paths run under vitest's
 * fake timers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShortcutRouter } from '../src/shortcuts.ts'
import {
  createRendererShortcutBridge,
  registerRendererShortcuts,
  SHELL_SHORTCUT_CHANNEL,
  SHELL_SHORTCUT_TIMEOUT_MS,
  type ShortcutBridgeWindow,
  type ShortcutClaimReply,
} from '../src/renderer-shortcuts.ts'

/** One captured ask, as the main process sent it. */
interface CapturedAsk {
  channel: string
  payload: { name: string; requestId: string }
}

/** A fake window recording every ask; `overrides` replace individual members. */
function fakeWindow(overrides: Partial<ShortcutBridgeWindow> = {}): {
  win: ShortcutBridgeWindow
  sent: CapturedAsk[]
  closedListeners: Array<() => void>
} {
  const sent: CapturedAsk[] = []
  const closedListeners: Array<() => void> = []
  return {
    win: {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        send: (channel, payload) => { sent.push({ channel, payload: payload as { name: string; requestId: string } }) },
      },
      on: (_event, listener) => { closedListeners.push(listener) },
      ...overrides,
    },
    sent,
    closedListeners,
  }
}

/** The reply that settles `ask`'s last sent request. */
function reply(name: string, sent: readonly CapturedAsk[], claimed: boolean): ShortcutClaimReply {
  const request = sent.at(-1)
  if (request === undefined) throw new Error('expected an ask to have been sent')
  return { name, requestId: request.payload.requestId, claimed }
}

/** A window whose webContents is destroyed or still loading, per `contentsOverrides`. */
function unreachableWindow(overrides: {
  readonly window?: Partial<ShortcutBridgeWindow>
  readonly contents?: { destroyed?: boolean; loading?: boolean }
} = {}): ShortcutBridgeWindow {
  const { window: windowOverrides, contents } = overrides
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => contents?.destroyed === true,
      isLoading: () => contents?.loading === true,
      send: () => { throw new Error('an unreachable window must not be asked') },
    },
    on: () => {},
    ...windowOverrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createRendererShortcutBridge', () => {
  it('asks the page and resolves true with its claim', async () => {
    const sent: Array<{ name: string; requestId: string }> = []
    const bridge = createRendererShortcutBridge((name, requestId) => { sent.push({ name, requestId }) })
    const claim = bridge.ask('cmd-w')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.name).toBe('cmd-w')
    expect(typeof sent[0]?.requestId).toBe('string')
    bridge.receiveClaim({ name: 'cmd-w', requestId: sent[0]!.requestId, claimed: true })
    await expect(claim).resolves.toBe(true)
  })

  it('resolves false on an unclaimed reply', async () => {
    const sent: Array<{ name: string; requestId: string }> = []
    const bridge = createRendererShortcutBridge((name, requestId) => { sent.push({ name, requestId }) })
    const claim = bridge.ask('cmd-w')
    bridge.receiveClaim({ name: 'cmd-w', requestId: sent[0]!.requestId, claimed: false })
    await expect(claim).resolves.toBe(false)
  })

  it('resolves false when the page never answers', async () => {
    vi.useFakeTimers()
    const bridge = createRendererShortcutBridge(() => {})
    const claim = bridge.ask('cmd-w')
    vi.advanceTimersByTime(SHELL_SHORTCUT_TIMEOUT_MS)
    await expect(claim).resolves.toBe(false)
  })

  it('does not settle twice for a duplicate or unrelated reply', async () => {
    vi.useFakeTimers()
    const sent: Array<{ name: string; requestId: string }> = []
    const bridge = createRendererShortcutBridge((name, requestId) => { sent.push({ name, requestId }) })
    const claim = bridge.ask('cmd-w')
    bridge.receiveClaim({ name: 'cmd-w', requestId: 'unknown', claimed: true })
    bridge.receiveClaim({ name: 'cmd-w', requestId: sent[0]!.requestId, claimed: true })
    bridge.receiveClaim({ name: 'cmd-w', requestId: sent[0]!.requestId, claimed: false })
    await expect(claim).resolves.toBe(true)
  })

  it('resolves every pending ask false on dispose', async () => {
    const bridge = createRendererShortcutBridge(() => {})
    const first = bridge.ask('cmd-w')
    const second = bridge.ask('cmd-w')
    bridge.dispose()
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
  })

  it('resolves further asks false after dispose', async () => {
    const bridge = createRendererShortcutBridge(vi.fn())
    bridge.dispose()
    await expect(bridge.ask('cmd-w')).resolves.toBe(false)
  })

  it('resolves concurrently pending asks independently', async () => {
    vi.useFakeTimers()
    const sent: Array<{ name: string; requestId: string }> = []
    const bridge = createRendererShortcutBridge((name, requestId) => { sent.push({ name, requestId }) })
    const first = bridge.ask('cmd-w')
    const second = bridge.ask('cmd-w')
    bridge.receiveClaim({ name: 'cmd-w', requestId: sent[0]!.requestId, claimed: true })
    vi.advanceTimersByTime(SHELL_SHORTCUT_TIMEOUT_MS)
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
  })
})

describe('registerRendererShortcuts', () => {
  it('asks only its own window and claims the route on the page reply', async () => {
    vi.useFakeTimers()
    const router = createShortcutRouter()
    const { win, sent } = fakeWindow()
    const { bridge } = registerRendererShortcuts(win, router)
    const claim = router.route('cmd-w')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.channel).toBe(SHELL_SHORTCUT_CHANNEL)
    bridge.receiveClaim({ name: 'cmd-w', requestId: sent[0]!.payload.requestId, claimed: true })
    await expect(claim).resolves.toBe('claimed')
  })

  it('keeps the route unclaimed when the page declines', async () => {
    vi.useFakeTimers()
    const router = createShortcutRouter()
    const { win, sent } = fakeWindow()
    const { bridge } = registerRendererShortcuts(win, router)
    const claim = router.route('cmd-w')
    bridge.receiveClaim(reply('cmd-w', sent, false))
    await expect(claim).resolves.toBe('unclaimed')
  })

  it.each([
    ['the window is destroyed', { window: { isDestroyed: () => true } }],
    ['the contents are destroyed', { contents: { destroyed: true } }],
    ['the contents are still loading', { contents: { loading: true } }],
  ])('passes the press unclaimed without asking while %s', async (_label, overrides) => {
    const router = createShortcutRouter()
    const win = unreachableWindow(overrides)
    registerRendererShortcuts(win, router)
    await expect(router.route('cmd-w')).resolves.toBe('unclaimed')
  })

  it('stops at the claiming bridge ahead of later handlers', async () => {
    vi.useFakeTimers()
    const router = createShortcutRouter()
    const { win, sent } = fakeWindow()
    const { bridge } = registerRendererShortcuts(win, router)
    const later = vi.fn(() => true)
    router.register('cmd-w', later)
    const claim = router.route('cmd-w')
    bridge.receiveClaim(reply('cmd-w', sent, true))
    await expect(claim).resolves.toBe('claimed')
    expect(later).not.toHaveBeenCalled()
  })

  it('unregisters the handler and settles pending asks on window close', async () => {
    vi.useFakeTimers()
    const router = createShortcutRouter()
    const { win, sent, closedListeners } = fakeWindow()
    registerRendererShortcuts(win, router)
    const claim = router.route('cmd-w')
    expect(sent).toHaveLength(1)
    closedListeners.forEach((listener) => { listener() })
    await expect(claim).resolves.toBe('unclaimed')
    await expect(router.route('cmd-w')).resolves.toBe('unclaimed')
    expect(sent).toHaveLength(1)
  })

  it('resolves an in-flight close unclaimed on the 1.5s timeout', async () => {
    vi.useFakeTimers()
    const router = createShortcutRouter()
    const { win } = fakeWindow()
    registerRendererShortcuts(win, router)
    const claim = router.route('cmd-w')
    vi.advanceTimersByTime(SHELL_SHORTCUT_TIMEOUT_MS)
    await expect(claim).resolves.toBe('unclaimed')
  })
})
