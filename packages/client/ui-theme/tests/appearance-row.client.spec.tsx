// @vitest-environment jsdom
/** AppearanceRow behavior: three preference cubes and the paper-tone entry —
 * current-tone display, in-place selection panel with paper-identity
 * swatches, clicks drive setTheme and setPaper, selection follows the store
 * mirror. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { PaperTone } from '../src/paper-tones.ts'
import type { ThemePreference } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.paper.title': 'Paper tone',
  'appearance.paper.default': 'Default',
  'appearance.paper.cream': 'Cream',
  'appearance.paper.sepia': 'Sepia',
  'appearance.paper.green': 'Green',
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

function mount(preference: ThemePreference = 'system', paper: PaperTone = 'default') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, paper, 0)
  const setTheme = vi.fn()
  const setPaper = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setTheme,
    setPaper,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setPaper }
}

const pressed = (name: RegExp | string): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

const paperTiles = (): HTMLElement[] =>
  ['Default', 'Cream', 'Sepia', 'Green'].map(name => screen.getByRole('button', { name }))

describe('AppearanceRow', () => {
  it('renders the title, the three preference cubes, and the collapsed paper-tone entry', () => {
    mount('dark', 'cream')
    expect(screen.getByText('Appearance')).toBeDefined()
    expect(pressed(/Dark/)).toBe('true')
    expect(pressed(/Light/)).toBe('false')
    expect(pressed(/System/)).toBe('false')
    // The entry shows the current tone and stays collapsed: no tone tiles yet.
    const entry = screen.getByRole('button', { name: /Paper tone/ })
    expect(entry.textContent).toContain('Cream')
    expect(entry.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Sepia' })).toBeNull()
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /Light/ }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed(/Dark/)).toBe('true')
    act(() => { b.store.actions.sync('light', 'default', 1) })
    expect(pressed(/Light/)).toBe('true')
    expect(pressed(/Dark/)).toBe('false')
  })

  it('the entry expands to tone tiles with paper-identity swatches; tiles drive setPaper', () => {
    const b = mount('light', 'sepia')
    fireEvent.click(screen.getByRole('button', { name: /Paper tone/ }))
    const [defaultTile, , sepiaTile, greenTile] = paperTiles()
    // The entry value and the selected tile both read the persisted tone.
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
    act(() => { b.store.actions.sync('light', 'cream', 1) })
    expect(pressed('Cream')).toBe('true')
    expect(pressed('Sepia')).toBe('false')
    // The entry value follows the mirror, not the click echo.
    expect(screen.getByRole('button', { name: /Paper tone/ }).textContent).toContain('Cream')

    // Toggling the entry collapses the panel again.
    fireEvent.click(screen.getByRole('button', { name: /Paper tone/ }))
    expect(screen.queryByRole('button', { name: 'Sepia' })).toBeNull()
  })
})
