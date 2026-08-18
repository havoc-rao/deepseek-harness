// @vitest-environment jsdom
// DiffBlock: the per-file hunk rows (path header, removed block, added block),
// the per-hunk +/- line-count badge on every hunk header, the same-file
// second-hunk gap separator, the `+A -R · N file(s)` footer and its
// singular/plural, the head/tail height cap and its expand control, the
// empty-diffs null render, and the copy control writing the prefixed diff text
// on both the accepted and the refused clipboard paths. writeClipboard's own
// return contract is pinned in terminal-block.spec.tsx (the shared return contract), so
// only its DOM consequence is asserted here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_DIFF_MAX_LINES, DiffBlock, diffLineCounts, type DiffHunk } from '../src/index.ts'

afterEach(cleanup)

beforeEach(() => {
  vi.useRealTimers()
})

/** The rendered body rows, one string per visible line (CSS-module class prefix). */
function bodyRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_line_"]')].map(row => row.textContent ?? '')
}

/** Only the changed rows (add/del), excluding the path header and gap chrome. */
function changeRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_del_"], [class*="_add_"]')].map(row => row.textContent ?? '')
}

/** `count` numbered added lines as one hunk's newText. */
function added(count: number): string {
  return Array.from({ length: count }, (_v, i) => `line ${i + 1}`).join('\n')
}

/** The badge terms (`+A`/`-R`), one span each, on the row whose text starts with `rowText`. */
function badgeTerms(container: HTMLElement, rowText: string): string[] | null {
  const row = [...container.querySelectorAll('[class*="_line_"]')]
    .find(candidate => candidate.textContent?.startsWith(rowText) === true)
  if (row === undefined) throw new Error(`no rendered row starting with ${rowText}`)
  const badge = row.querySelector('[class*="_hunkBadge_"]')
  if (badge === null) return null
  return [...badge.querySelectorAll('span')].map(span => span.textContent ?? '')
}

describe('DiffBlock structure', () => {
  it('renders a create as a path header and an added block (no removed side)', () => {
    const diffs: DiffHunk[] = [{ path: 'notes/new.txt', oldText: null, newText: 'hello\nworld' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('notes/new.txt')).toBeTruthy()
    // No removed rows: both change lines are added.
    expect(changeRows(container)).toEqual(['hello', 'world'])
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(0)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(2)
  })

  it('renders an edit as a removed block above an added block', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'old', newText: 'new' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
    expect(changeRows(container)).toEqual(['old', 'new'])
  })

  it('opens a same-file second hunk with a gap instead of repeating the path', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    // One path header, one gap row.
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_gap_"]').length).toBe(1)
  })

  it('opens a new file with its own path header', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'b.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(2)
    expect(container.querySelectorAll('[class*="_gap_"]').length).toBe(0)
  })

  it('renders nothing for empty diffs', () => {
    const { container } = render(<DiffBlock diffs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('treats a trailing newline as a terminator, not an extra blank line', () => {
    // A create whose newText ends in a newline is one added line, not two, and
    // the footer counts one — the phantom `+ ` empty line the naive split drew.
    const { container } = render(<DiffBlock diffs={[{ path: 'n.txt', oldText: null, newText: 'hello\n' }]} />)
    expect(changeRows(container)).toEqual(['hello'])
    expect(screen.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('renders a full deletion as removed-only with no phantom added line', () => {
    // newText '' is zero added lines: an empty string must contribute nothing.
    const { container } = render(<DiffBlock diffs={[{ path: 'gone.ts', oldText: 'a\nb', newText: '' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(0)
    expect(screen.getByText('└ +0 -2 · 1 file')).toBeTruthy()
  })

  it('keeps a genuine interior blank line', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x\n\ny' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(3)
  })
})

describe('DiffBlock hunk badge', () => {
  it('badges an edit hunk header with its added and removed counts', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb', newText: 'c\nd\ne' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(badgeTerms(container, 'a.ts')).toEqual(['+3', '-2'])
  })

  it('badges only the added term on a create', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'n.txt', oldText: null, newText: 'x\ny' }]} />)
    expect(badgeTerms(container, 'n.txt')).toEqual(['+2'])
  })

  it('badges only the removed term on a full deletion', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'gone.ts', oldText: 'a\nb\nc', newText: '' }]} />)
    expect(badgeTerms(container, 'gone.ts')).toEqual(['-3'])
  })

  it('badges a same-file second hunk on its gap row with its own counts', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'a.ts', oldText: 'p\nq', newText: 'r' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(badgeTerms(container, 'a.ts')).toEqual(['+1', '-1'])
    expect(badgeTerms(container, '⋯')).toEqual(['+1', '-2'])
  })

  it('leaves change lines unbadged', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} />)
    for (const text of ['old', 'new']) {
      const row = [...container.querySelectorAll('[class*="_line_"]')].find(candidate => candidate.textContent === text)
      expect(row?.querySelector('[class*="_hunkBadge_"]')).toBeNull()
    }
  })

  it('omits the badge for a no-op hunk with nothing to count', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: '', newText: '' }]} />)
    expect(container.querySelector('[class*="_hunkBadge_"]')).toBeNull()
    expect(screen.getByText('└ +0 -0 · 1 file')).toBeTruthy()
  })
})

describe('diffLineCounts', () => {
  it('sums added and removed across hunks under the terminator rule', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'a\nb', newText: '' },
      { path: 'a.ts', oldText: null, newText: 'c\nd\ne\n' },
    ]
    // A trailing newline terminates its last line; an interior blank line counts.
    expect(diffLineCounts(diffs)).toEqual({ added: 3, removed: 2 })
  })

  it('counts a create and a full deletion', () => {
    expect(diffLineCounts([{ path: 'n.txt', oldText: null, newText: 'x\ny' }])).toEqual({ added: 2, removed: 0 })
    expect(diffLineCounts([{ path: 'gone.ts', oldText: 'a\nb\nc', newText: '' }])).toEqual({ added: 0, removed: 3 })
  })

  it('returns zeros for empty diffs', () => {
    expect(diffLineCounts([])).toEqual({ added: 0, removed: 0 })
  })
})

describe('DiffBlock footer', () => {
  it('counts added and removed lines and one file', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb', newText: 'c' }]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +1 -2 · 1 file')).toBeTruthy()
  })

  it('pluralizes the distinct-file count', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: null, newText: 'x' },
      { path: 'b.ts', oldText: null, newText: 'y' },
    ]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +2 -0 · 2 files')).toBeTruthy()
  })
})

describe('DiffBlock height cap', () => {
  it('shows head and tail with an expand control past the cap, then all lines expanded', () => {
    // One added line over the default cap forces the collapse.
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(DEFAULT_DIFF_MAX_LINES) }]
    // The path header counts as a row, so a body of maxLines added lines plus
    // the header is one over the cap.
    const { container } = render(<DiffBlock diffs={diffs} />)
    const toggle = screen.getByRole('button', { name: /展开其余/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Collapsed shows fewer rows than the full body.
    const collapsedCount = bodyRows(container).length
    expect(collapsedCount).toBeLessThan(DEFAULT_DIFF_MAX_LINES + 1)
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起差异' }).getAttribute('aria-expanded')).toBe('true')
    expect(bodyRows(container).length).toBeGreaterThan(collapsedCount)
  })

  it('shows no expand control at or under the cap', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(4) }]
    render(<DiffBlock diffs={diffs} maxLines={16} />)
    expect(screen.queryByRole('button', { name: /展开其余|收起差异/ })).toBeNull()
  })
})

describe('DiffBlock copy', () => {
  it('copies the prefixed diff text and flips the label on success', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'old', newText: 'new' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    render(<DiffBlock diffs={diffs} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    // Path header, del/add prefixes, and the same-file gap all reach the clipboard.
    expect(writeText).toHaveBeenCalledWith('a.ts\n- old\n+ new\n⋯\n- p\n+ q')
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('keeps the label on a refused clipboard write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('ignores a second click while the copied label is showing', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制成功' })) })
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
