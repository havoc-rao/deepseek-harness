// @vitest-environment jsdom
/** PaperToneRow behavior: current-tone entry, in-place selection panel with
 * paper-identity swatches, clicks drive setPaper, selection follows the
 * store mirror. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { PaperToneRow } from '../src/client/PaperToneRow.tsx'
import type { PaperToneRowComponentProps } from '../src/client/PaperToneRow.tsx'
import { createPaperRowStore } from '../src/client/settings-store.ts'
import type { PaperTone } from '@deepseek-ai/dsh-client-ui-theme/client'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'paper.title': 'Paper tone',
  'paper.default': 'Default',
  'paper.cream': 'Cream',
  'paper.sepia': 'Sepia',
  'paper.green': 'Green',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(paper: PaperTone = 'default') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createPaperRowStore().create()
  store.actions.sync(paper, 0)
  const setPaper = vi.fn()
  const props: PaperToneRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setPaper,
  }
  render(<PaperToneRow {...props} />)
  return { store, setPaper }
}

const pressed = (name: string): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

const paperTiles = (): HTMLElement[] =>
  ['Default', 'Cream', 'Sepia', 'Green'].map(name => screen.getByRole('button', { name }))

describe('PaperToneRow', () => {
  it('renders the collapsed entry showing the current tone', () => {
    mount('cream')
    const entry = screen.getByRole('button', { name: /Paper tone/ })
    expect(entry.textContent).toContain('Cream')
    expect(entry.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Sepia' })).toBeNull()
  })

  it('the entry expands to tone tiles with paper-identity swatches; tiles drive setPaper', () => {
    const b = mount('sepia')
    fireEvent.click(screen.getByRole('button', { name: /Paper tone/ }))
    const [defaultTile, , sepiaTile, greenTile] = paperTiles()
    // The selected tile reads the persisted tone.
    expect(pressed('Sepia')).toBe('true')
    expect(pressed('Cream')).toBe('false')
    // Paper-identity swatches: the layer's light bg-base per tone; the
    // default tone falls back to the neutral paper white.
    const swatchOf = (tile: HTMLElement): string =>
      (tile.firstChild as HTMLElement).style.backgroundColor
    expect(swatchOf(defaultTile!)).toBe('rgb(255, 255, 255)')
    expect(swatchOf(sepiaTile!)).toBe('rgb(250, 244, 231)')
    expect(swatchOf(greenTile!)).toBe('rgb(248, 251, 246)')

    fireEvent.click(screen.getByRole('button', { name: 'Cream' }))
    expect(b.setPaper).toHaveBeenCalledWith('cream')
    // No store write yet: selection is unchanged.
    expect(pressed('Sepia')).toBe('true')
    act(() => { b.store.actions.sync('cream', 1) })
    expect(pressed('Cream')).toBe('true')
    expect(pressed('Sepia')).toBe('false')
    // The entry value follows the mirror, not the click echo.
    expect(screen.getByRole('button', { name: /Paper tone/ }).textContent).toContain('Cream')

    // Toggling the entry collapses the panel again.
    fireEvent.click(screen.getByRole('button', { name: /Paper tone/ }))
    expect(screen.queryByRole('button', { name: 'Sepia' })).toBeNull()
  })
})
