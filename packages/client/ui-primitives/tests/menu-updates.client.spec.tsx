// @vitest-environment jsdom
/** Menu lifecycle during synchronous external-store streaming updates. */
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { act, fireEvent, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { Menu } from '../src/Menu.tsx'

it('keeps closed menus quiet during streaming and clears submenus before reopening with the latest close callback', async () => {
  let snapshot = { revision: 0, open: false }
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const getSnapshot = () => snapshot
  const publish = (open = snapshot.open): void => {
    snapshot = { revision: snapshot.revision + 1, open }
    for (const listener of listeners) listener()
  }
  const closed = vi.fn<(revision: number) => void>()
  function StreamingMenus() {
    const current = useSyncExternalStore(subscribe, getSnapshot)
    return <>
      <output>{current.revision}</output>
      {[0, 1].map(index => <Menu key={index} open={index === 0 && current.open}
        anchor={<button>Trigger {index}</button>}
        items={[{ id: 'parent', label: 'Parent', submenu: [{ id: 'child', label: 'Child' }] }]}
        onClose={() => { closed(current.revision); publish(false) }} />)}
    </>
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const originalError = console.error
  const errors = vi.spyOn(console, 'error').mockImplementation((...args: Parameters<typeof console.error>) => {
    if (!args.some(value => String(value).includes('Maximum update depth exceeded'))) originalError(...args)
  })
  try {
    flushSync(() => { root.render(<StreamingMenus />) })
    // Streaming notifications are independent synchronous commits, not one act batch.
    for (let event = 0; event < 120; event++) {
      await Promise.resolve()
      flushSync(() => { publish() })
    }
    expect(screen.getByRole('status').textContent).toBe(String(snapshot.revision))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(errors.mock.calls.filter(args => args.some(value => String(value).includes('Maximum update depth exceeded')))).toEqual([])

    flushSync(() => { publish(true) })
    flushSync(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Parent' })) })
    expect(screen.getByRole('menuitem', { name: 'Child' })).toBeTruthy()
    await act(async () => { flushSync(() => { publish(false) }) })
    await act(async () => { flushSync(() => { publish(true) }) })
    expect(screen.queryByRole('menuitem', { name: 'Child' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Parent' }).getAttribute('aria-expanded')).toBe('false')
    flushSync(() => { publish() })
    const latestRevision = snapshot.revision
    flushSync(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(closed.mock.calls).toEqual([[latestRevision]])
    expect(screen.queryByRole('menu')).toBeNull()
    flushSync(() => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(closed.mock.calls).toEqual([[latestRevision]])
    expect(errors.mock.calls.filter(args => args.some(value => String(value).includes('Maximum update depth exceeded')))).toEqual([])
  } finally {
    flushSync(() => { root.unmount() })
    container.remove()
    errors.mockRestore()
  }
  expect(listeners.size).toBe(0)
})
