// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { OpenInAppTargetPayload } from '@deepseek-ai/dsh-host-open-in-app/shared'
import { OpenInAppAction, type OpenInAppActionProps } from '../src/client/OpenInAppAction.tsx'
import type { OpenInAppAvailability } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const SESSION = 'session' as SessionId
const t: OpenInAppActionProps['t'] = makeTranslate(zh)

interface Bench {
  props: OpenInAppActionProps
  launch: ReturnType<typeof vi.fn>
  choose: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  setCwd: (cwd: string | undefined) => void
}

function bench(over: {
  apps?: readonly string[] | null
  target?: OpenInAppTargetPayload | null
  choice?: string
  cwd?: string
  launch?: (appId: string, path: string, sessionId?: string) => Promise<void>
} = {}): Bench {
  const state = {
    ids: [SESSION],
    byId: over.cwd === undefined ? {} : { [SESSION]: { cwd: over.cwd } },
    current: SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  // An absent map entry is the "availability not read yet" state.
  const availability = createSnapshotStore<ReadonlyMap<string, OpenInAppAvailability>>(
    over.apps == null || over.cwd === undefined || over.cwd === ''
      ? new Map()
      : new Map([[over.cwd, { apps: over.apps, target: over.target ?? null }]]),
  )
  const choice = createSnapshotStore<string>(over.choice ?? '')
  const launch = vi.fn(over.launch ?? (async () => {}))
  const choose = vi.fn()
  const load = vi.fn(async () => {})
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state as unknown as SessionListState)
  }
  function useSelector<T, R>(source: { getSnapshot(): T }): (select: (value: T) => R) => R {
    return select => select(source.getSnapshot())
  }
  const props = {
    sessionId: SESSION,
    useSessions,
    useOpenInAppAvailability: useSelector(availability),
    useOpenInAppChoice: useSelector(choice),
    load,
    launch,
    choose,
    iconUrl: (appId: string) => `/open-in-app/icon/${appId}`,
    t,
  } as unknown as OpenInAppActionProps
  return {
    props,
    launch,
    choose,
    load,
    setCwd: (cwd) => {
      state.byId = cwd === undefined ? {} : { [SESSION]: { cwd } }
    },
  }
}

describe('OpenInAppAction visibility', () => {
  it('renders nothing before availability arrives, with no apps, without a cwd, and for unnameable ids', () => {
    for (const over of [
      { apps: null, cwd: '/w' },
      { apps: [], cwd: '/w' },
      { apps: [], choice: 'vscode', cwd: '/w' },
      { apps: ['finder'] },
      { apps: ['finder'], cwd: '' },
      { apps: ['someday-an-app'], cwd: '/w' },
    ] as const) {
      const { container } = render(<OpenInAppAction {...bench(over).props} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('shows the remembered choice, falling back to the first available app when it is gone', () => {
    render(<OpenInAppAction {...bench({ apps: ['finder', 'cursor'], choice: 'cursor', cwd: '/w' }).props} />)
    expect(screen.getByRole('button', { name: zh['open.title'].replace('{app}', 'Cursor') })).toBeDefined()
    cleanup()

    render(<OpenInAppAction {...bench({ apps: ['finder', 'cursor'], choice: 'vscode', cwd: '/w' }).props} />)
    expect(screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })).toBeDefined()
  })

  it('names a newly cataloged application id through the dictionaries', () => {
    render(<OpenInAppAction {...bench({ apps: ['codebuddy'], cwd: '/w' }).props} />)
    expect(screen.getByRole('button', { name: zh['open.title'].replace('{app}', 'CodeBuddy') })).toBeDefined()
  })

  it('re-reads availability when the session cwd changes', () => {
    const b = bench({ apps: ['finder'], cwd: '/w/one' })
    const { rerender } = render(<OpenInAppAction {...b.props} />)
    expect(b.load).toHaveBeenCalledWith('/w/one', SESSION)
    b.setCwd('/w/two')
    rerender(<OpenInAppAction {...b.props} />)
    expect(b.load).toHaveBeenLastCalledWith('/w/two', SESSION)
  })

  it('does not read availability before the session has a cwd', () => {
    const b = bench({ apps: ['finder'] })
    render(<OpenInAppAction {...b.props} />)
    expect(b.load).not.toHaveBeenCalled()
  })
})

describe('OpenInAppAction launching', () => {
  it('launches without painting the busy dress when the launch settles quickly', async () => {
    let resolve: () => void = () => {}
    const b = bench({
      apps: ['finder'],
      cwd: '/w/dir',
      launch: () => new Promise((r) => { resolve = r }),
    })
    render(<OpenInAppAction {...b.props} />)
    const main = screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })
    fireEvent.click(main)
    expect(b.launch).toHaveBeenCalledWith('finder', '/w/dir', SESSION)
    // No flash: the button keeps its idle dress while the launch is fast.
    expect((main as HTMLButtonElement).disabled).toBe(false)
    expect(main.getAttribute('data-state')).toBe('idle')
    // A second click while in flight is ignored rather than double-launching.
    fireEvent.click(main)
    expect(b.launch).toHaveBeenCalledTimes(1)

    resolve()
    await waitFor(() => {
      fireEvent.click(main)
      expect(b.launch).toHaveBeenCalledTimes(2)
    })
  })

  it('dresses a slow launch as busy, then shows the error state on failure', async () => {
    vi.useFakeTimers()
    let reject: (error: Error) => void = () => {}
    const b = bench({
      apps: ['finder'],
      cwd: '/w/dir',
      launch: () => new Promise((_, r) => { reject = r }),
    })
    render(<OpenInAppAction {...b.props} />)
    const main = screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })
    fireEvent.click(main)

    // The busy dress appears only after the launch has taken a while.
    act(() => { vi.advanceTimersByTime(300) })
    expect((main as HTMLButtonElement).disabled).toBe(true)
    expect(main.getAttribute('data-state')).toBe('busy')

    act(() => { reject(new Error('launch failed')) })
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })).toBeDefined()
  })

  it('shows the error state and decays back to idle after a fast failure', async () => {
    const b = bench({
      apps: ['finder'],
      cwd: '/w/dir',
      launch: () => Promise.reject(new Error('launch failed')),
    })
    render(<OpenInAppAction {...b.props} />)
    const main = screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })
    fireEvent.click(main)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: zh['open.error'] })).toBeDefined()
    })
    // The error state decays back to idle.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })).toBeDefined()
    }, { timeout: 4_000 })
  })

  it('shows the product tooltip on hover instead of a native title', async () => {
    render(<OpenInAppAction {...bench({ apps: ['finder'], cwd: '/w/dir' }).props} />)
    const main = screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })
    expect(main.getAttribute('title')).toBeNull()
    fireEvent.mouseEnter(main)
    expect(await screen.findByText(zh['open.tooltip'])).toBeDefined()
    fireEvent.mouseLeave(main)
    await waitFor(() => {
      expect(screen.queryByText(zh['open.tooltip'])).toBeNull()
    })
  })

  it('names a claimed remote target in the title and tooltip', async () => {
    const b = bench({
      apps: ['cursor'],
      cwd: '/w/dir',
      target: { provider: 'dsh-remote', label: 'root@host:/srv/app' },
    })
    render(<OpenInAppAction {...b.props} />)
    const main = screen.getByRole('button', { name: zh['open.titleRemote'].replace('{app}', 'Cursor') })
    fireEvent.mouseEnter(main)
    expect(await screen.findByText(zh['open.tooltipRemote'].replace('{label}', 'root@host:/srv/app'))).toBeDefined()
  })

  it('opens the menu from the chevron, launches and persists a picked app', async () => {
    const b = bench({ apps: ['finder', 'cursor', 'terminal'], cwd: '/w/dir' })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.toggle'] }))
    const cursorItem = await screen.findByText('Cursor')
    fireEvent.click(cursorItem)
    expect(b.choose).toHaveBeenCalledWith('cursor')
    expect(b.launch).toHaveBeenCalledWith('cursor', '/w/dir', SESSION)
  })

  it('ignores a menu pick while a launch is in flight', async () => {
    let resolve: () => void = () => {}
    const b = bench({
      apps: ['finder', 'cursor'],
      cwd: '/w/dir',
      launch: () => new Promise((r) => { resolve = r }),
    })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) }))
    expect(b.launch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.toggle'] }))
    fireEvent.click(await screen.findByText('Cursor'))
    // Mid-flight the pick is ignored whole: no persisted choice, no launch.
    expect(b.choose).not.toHaveBeenCalled()
    expect(b.launch).toHaveBeenCalledTimes(1)
    resolve()
    await act(async () => {})
  })

  it('clears a pending error decay when a retry starts', async () => {
    vi.useFakeTimers()
    const outcomes: Array<() => Promise<void>> = [
      () => Promise.reject(new Error('launch failed')),
      // The retry stays in flight past the original decay deadline.
      () => new Promise(() => {}),
    ]
    const b = bench({
      apps: ['finder'],
      cwd: '/w/dir',
      launch: () => (outcomes.shift() ?? (() => Promise.resolve()))(),
    })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: zh['open.error'] }))
    // Past the first failure's 2s decay: the stale timer must not flip the
    // in-flight retry's busy dress back to a clickable idle button.
    act(() => { vi.advanceTimersByTime(2_500) })
    const main = screen.getByRole('button', { name: zh['open.title'].replace('{app}', zh['app.finder']) })
    expect(main.getAttribute('data-state')).toBe('busy')
    expect((main as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes an open menu on Escape without launching', async () => {
    const b = bench({ apps: ['finder', 'terminal'], cwd: '/w/dir' })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.toggle'] }))
    await screen.findByText(zh['app.terminal'])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText(zh['app.terminal'])).toBeNull()
    })
    expect(b.launch).not.toHaveBeenCalled()
  })

  it('falls back to the generic icon after a failed image load', async () => {
    const b = bench({ apps: ['terminal'], cwd: '/w/dir' })
    const { container } = render(<OpenInAppAction {...b.props} />)
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/open-in-app/icon/terminal')
    if (img !== null) fireEvent.error(img)
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelector('svg rect')).not.toBeNull()
    })
  })
})
