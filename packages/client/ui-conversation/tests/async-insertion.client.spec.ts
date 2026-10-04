/** Late input insertions preserve references, subsequent edits, and undo ownership. */
import { Context } from '@deepseek-ai/cordis'
import { UNDO_COMMAND } from 'lexical'
import { expect, it, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'

function shell(): SessionInputShell {
  return new SessionInputShell({ actx: new Context(), defaultSink: vi.fn(), commandAttachments: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => '',
  } })
}

it('inserts text beside an existing reference and undoes only that insertion', async () => {
  const input = shell()
  try {
    input.setDraft('@ref')
    input.insertReference({ source: 'file', ref: 'src/main.ts', label: 'main.ts', clipboardText: '@[main.ts](src/main.ts)' },
      { start: 0, end: 4, draftRev: input.state.getSnapshot().draftRev })
    const original = input.state.getSnapshot()
    expect(input.actions.insertText(' check types', input.actions.captureInsertion())).toBe(true)
    expect(input.state.getSnapshot().draft).toContain('check types')
    expect(input.state.getSnapshot().occurrences).toEqual(original.occurrences)
    input.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await vi.waitFor(() => { expect(input.state.getSnapshot().draft).toBe(original.draft) })
  } finally { input.dispose() }
})

it('inserts consecutive atomic references using captured editor coordinates', () => {
  const input = shell()
  try {
    const reference = { source: 'reference', ref: '@workspace-id/example', label: 'Example workspace', clipboardText: '@workspace-id/example' }
    expect(input.actions.insertReference(reference, input.actions.captureInsertion())).toBe(true)
    expect(input.actions.insertReference(reference, input.actions.captureInsertion())).toBe(true)
    expect(input.snapshot.occurrences).toHaveLength(2)
    expect(input.snapshot.draft).toBe('@workspace-id/example @workspace-id/example ')
    expect(input.draftSnapshot.references).toHaveLength(2)
  } finally { input.dispose() }
})

it('refuses a reference captured before an edit or after disposal without changing the draft', () => {
  const input = shell()
  const reference = { source: 'reference', ref: '@workspace-id/example', label: 'Example', clipboardText: '@workspace-id/example' }
  const stale = input.actions.captureInsertion()
  input.setDraft('newer')
  expect(input.actions.insertReference(reference, stale)).toBe(false)
  expect(input.snapshot.draft).toBe('newer')
  const current = input.actions.captureInsertion()
  input.dispose()
  expect(input.actions.insertReference(reference, current)).toBe(false)
  const focus = vi.spyOn(input.editor, 'focus')
  input.actions.focus()
  expect(focus).not.toHaveBeenCalled()
})

it('refuses results captured before a user edit or after editor disposal', () => {
  const input = shell()
  input.setDraft('before')
  const span = input.actions.captureInsertion()
  input.setDraft('my newer text')
  expect(input.actions.insertText('late voice', span)).toBe(false)
  expect(input.state.getSnapshot().draft).toBe('my newer text')
  const latest = input.actions.captureInsertion()
  input.dispose()
  expect(input.actions.insertText('late voice', latest)).toBe(false)
})
