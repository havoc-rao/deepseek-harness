// @vitest-environment jsdom
// The plugin's own surface: the FileMutationRow (the applied diff card plus the
// trailing +A -R totals suffix under both edit and write) and its keyed
// registration into the ui-tool-declared tool.call.toolview slot.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { RunningToolCall, SessionId, SessionListState, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { FileMutationRow, type FileMutationRowProps } from '../src/client/FileMutationRow.tsx'
import { apply, inject } from '../src/client/index.ts'

afterEach(cleanup)

const SID = 's1' as SessionId

const t = makeTranslate(zh, commonZh)

const ARGS = '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}'

/** The edit tool's own call view (a call-time diff derived from the arguments). */
const callDiff = (over?: Partial<Extract<ToolCallView, { card: 'diff' }>>): ToolCallView => ({
  card: 'diff', title: 'Edit notes/demo.txt',
  diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }], ...over,
})

/** The edit tool's own result view (the applied hunk diff). */
const resultDiff = (over?: Partial<Extract<ToolResultView, { card: 'diff' }>>): ToolResultView => ({
  card: 'diff', title: 'Edit notes/demo.txt',
  diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }], ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'edit', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: callDiff(), subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'edit', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'The file notes/demo.txt has been updated successfully.' }], isError: false,
  callView: callDiff(), resultView: resultDiff(), subCalls: [], ...over,
})

describe('FileMutationRow diff card', () => {
  const list = () => createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: '/w/app' } },
    current: SID,
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined,
  })

  const rowProps = (block: RunningToolCall | ToolResultNode, toolName = 'edit'): FileMutationRowProps => ({
    callId: 'c1', toolName, block, openFile: vi.fn(), cwd: '/w/app',
    sessionId: SID, useSessions: bindSnapshotSelector(list()),
    t,
  } as unknown as FileMutationRowProps)

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  /**
   * The collapsed row's colored +/- suffix terms: one entry per nonzero term,
   * with its text and which semantic color class it carries. The suffix slot
   * (ToolRow's `.summarySuffix`) wraps a layer-1 chip (`.suffixChip`), which in
   * turn holds one colored term span per nonzero side (`_suffixAdd_` on
   * success, `_suffixDel_` on error). Throws when no suffix is rendered, so a
   * caller expecting one fails loudly rather than on a later null deref.
   */
  const suffixTerms = (view: { container: HTMLElement }): { text: string; color: 'success' | 'error' }[] => {
    const slot = view.container.querySelector('[class*="_summarySuffix_"]')
    if (slot === null) throw new Error('no summarySuffix slot rendered')
    const terms = slot.querySelectorAll('span[class*="_suffixAdd_"], span[class*="_suffixDel_"]')
    return [...terms].map((span) => {
      const className = span.getAttribute('class') ?? ''
      const color = className.includes('_suffixAdd_') ? 'success' : 'error'
      return { text: span.textContent ?? '', color }
    })
  }

  it('collapses to the summary row; expanding reveals the applied diff card', () => {
    const view = render(<FileMutationRow {...rowProps(settled())} />)
    // The diff card is collapsed by default — not in the DOM until expanded.
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.queryByText('hello fixture')).toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(view.getByText('hello fixture')).toBeTruthy()
    expect(view.getByText('复制')).toBeTruthy()
  })

  it('the summary is a path link that opens the tool path through the host', () => {
    const openFile = vi.fn()
    const view = render(<FileMutationRow {...{ ...rowProps(settled()), openFile }} />)
    // The path link rides the collapsed summary, so it opens without expanding.
    fireEvent.click(view.getByRole('button', { name: 'notes/demo.txt' }))
    // The row passes the tool's own path; the injected openFile resolves it
    // against the session cwd (apply.ts), so the row must not resolve twice.
    expect(openFile).toHaveBeenCalledWith('notes/demo.txt')
  })

  it('registers under write too, rendering a create as an added-only diff', () => {
    const writeArgs = '{"file_path":"notes/new.txt","content":"hello fixture\\n"}'
    const view = render(<FileMutationRow {...rowProps(settled({
      call: { name: 'write', argsRaw: writeArgs },
      callView: { card: 'diff', title: 'Write notes/new.txt', diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture' }] },
      resultView: { card: 'diff', title: 'Write notes/new.txt', diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture' }] },
    }), 'write')} />)
    // The footer counts live inside the collapsed diff card.
    toggleRow(view)
    expect(view.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('trails the collapsed summary with the call total +A -R suffix', () => {
    // The edit fixture replaces one line, so the unexpanded row reads +1 -1 at
    // its right edge without opening the diff card. `+` colors on the success
    // token and `-` on the error token, matching the in-card hunk badge.
    const view = render(<FileMutationRow {...rowProps(settled())} />)
    expect(suffixTerms(view)).toEqual([
      { text: '+1', color: 'success' },
      { text: '-1', color: 'error' },
    ])
  })

  it('renders the suffix as a layer-1 chip, not bare trailing text', () => {
    // The totals sit in a small pill (one rung lighter than the row surface,
    // the same surface the in-card hunk badge uses) so they read as a badge.
    const view = render(<FileMutationRow {...rowProps(settled())} />)
    const chip = view.container.querySelector('[class*="_summarySuffix_"] [class*="_suffixChip_"]')
    expect(chip).not.toBeNull()
  })

  it('trails a running call with its intended change total', () => {
    const view = render(<FileMutationRow {...rowProps(running())} />)
    expect(suffixTerms(view)).toEqual([
      { text: '+1', color: 'success' },
      { text: '-1', color: 'error' },
    ])
  })

  it('trails a create with the added-only suffix', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      call: { name: 'write', argsRaw: '{"file_path":"notes/new.txt","content":"hello fixture\\n"}' },
      callView: { card: 'diff', title: 'Write notes/new.txt', diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture' }] },
      resultView: { card: 'diff', title: 'Write notes/new.txt', diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture' }] },
    }), 'write')} />)
    expect(suffixTerms(view)).toEqual([{ text: '+1', color: 'success' }])
  })

  it('trails a full deletion with the removed-only suffix', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      callView: { card: 'diff', title: 'Edit notes/demo.txt', diffs: [{ path: 'notes/demo.txt', oldText: 'a\nb', newText: '' }] },
      resultView: { card: 'diff', title: 'Edit notes/demo.txt', diffs: [{ path: 'notes/demo.txt', oldText: 'a\nb', newText: '' }] },
    }))} />)
    expect(suffixTerms(view)).toEqual([{ text: '-2', color: 'error' }])
  })

  it('omits the suffix for a no-op set of hunks', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      callView: { card: 'diff', title: 'Edit notes/demo.txt', diffs: [{ path: 'notes/demo.txt', oldText: '', newText: '' }] },
      resultView: { card: 'diff', title: 'Edit notes/demo.txt', diffs: [{ path: 'notes/demo.txt', oldText: '', newText: '' }] },
    }))} />)
    expect(view.container.querySelector('[class*="_summarySuffix_"]')).toBeNull()
  })

  it('keeps the suffix off an errored mutation', () => {
    const view = render(<FileMutationRow {...rowProps(settled({ isError: true, callView: null, resultView: null }))} />)
    expect(view.container.querySelector('[class*="_summarySuffix_"]')).toBeNull()
  })

  it('reflects the run state on its leading slot', () => {
    const runningView = render(<FileMutationRow {...rowProps(running())} />)
    expect(runningView.container.querySelector('[data-state="running"]')).not.toBeNull()
    cleanup()
    const errorView = render(<FileMutationRow {...rowProps(settled({ isError: true, resultView: null, callView: null }))} />)
    expect(errorView.container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('a mutation call with no diff view renders the summary row alone', () => {
    const view = render(<FileMutationRow {...rowProps(settled({ callView: null, resultView: null }))} />)
    // No diff material: expanding shows the args-JSON body, never a diff card.
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
  })

  it('surfaces the result text when an errored mutation has no diff card', () => {
    // write/edit return undefined from presentResult on isError, so the failure
    // has no diff — ToolRow shows the model-facing error text as the collapsed
    // summary's first line (errorSummary) instead of a bare red dot.
    const view = render(<FileMutationRow {...rowProps(settled({
      isError: true, callView: null, resultView: null,
      content: [{ type: 'text', text: 'old_string not found in notes/demo.txt' }],
    }))} />)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.getByText('old_string not found in notes/demo.txt')).toBeTruthy()
  })

  it('falls back to the error name/code when an errored result has no text block', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      isError: true, callView: null, resultView: null, content: [],
      error: { name: 'ToolError', code: 'sandbox_denied' },
    }))} />)
    expect(view.getByText('ToolError: sandbox_denied')).toBeTruthy()
  })

  it('shows no error summary for a successful diff or a running call', () => {
    // ToolRow's error-color summary line is set only on the error state.
    const ok = render(<FileMutationRow {...rowProps(settled())} />)
    expect(ok.container.querySelector('[class*="_errorSummary_"]')).toBeNull()
    cleanup()
    const run = render(<FileMutationRow {...rowProps(running())} />)
    expect(run.container.querySelector('[class*="_errorSummary_"]')).toBeNull()
  })

  it('shows the stopped state when the call was interrupted', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      callView: null, resultView: null, isError: true,
      error: { name: 'ToolError', code: 'interrupted' },
    }))} />)
    expect(view.container.querySelector('[data-state="stopped"]')).not.toBeNull()
    // The amber StateDot is aria-hidden, so ToolRow carries the state to AT as
    // visually-hidden text; without it a stopped row is a colour-only signal.
    expect(view.getByText('已停止')).toBeTruthy()
  })

  it('renders a plain summary span when the call carries no file path', () => {
    // Empty args leave deriveFilePath undefined, so the summary is not a link.
    const view = render(<FileMutationRow {...rowProps(settled({
      call: { name: 'edit', argsRaw: '' }, callView: null, resultView: null,
    }))} />)
    expect(view.container.querySelector('[class*="_fileLink_"]')).toBeNull()
    expect(view.container.querySelector('[class*="_summary_"]')).not.toBeNull()
  })
})

describe('fileMutationToolview registration', () => {
  it('registers one component under both edit and write, and each disposes', () => {
    const registered: { key: string; locale: unknown; disposed: boolean }[] = []
    const disposers: (() => void)[] = []
    let disposeInjection = (): void => {}
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => Iterable<() => void>) => {
          const active = [...callback()]
          disposeInjection = () => { for (const dispose of active.reverse()) dispose() }
          return disposeInjection
        },
        register: ({ key, locale }: { name: string; key: string; locale?: string }) => {
          const entry = { key, locale, disposed: false }
          registered.push(entry)
          const dispose = () => { entry.disposed = true }
          disposers.push(dispose)
          return dispose
        },
      },
    }
    apply(ctx as never)
    expect(registered.map(r => r.key).sort()).toEqual(['edit', 'write'])
    // Both keys claim the conversation locale seat ToolRow's body copy needs.
    expect(registered.map(r => r.locale)).toEqual(['conversation', 'conversation'])
    expect(inject).toEqual(['slots'])
    // Disposal removes each contribution (packages/AGENTS.md registry contract).
    disposeInjection()
    expect(registered.every(r => r.disposed)).toBe(true)
  })
})
