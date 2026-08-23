// @vitest-environment jsdom
// The pure diffCardModel derivation over callView/resultView — the single
// source both the chat row and the details panel draw the applied diff from.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { diffCardModel } from '../src/client/models/diff-card-model.ts'

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

describe('diffCardModel', () => {
  it('derives a running card from the call view alone', () => {
    expect(diffCardModel(running())).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }] },
    })
  })

  it('derives a settled card from the result view, which replaces the call-time diff', () => {
    // The applied hunks (result) win over the args-derived call diff.
    expect(diffCardModel(settled({
      resultView: resultDiff({ diffs: [{ path: 'notes/demo.txt', oldText: 'a', newText: 'b' }] }),
    }))).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'a', newText: 'b' }] },
    })
  })

  it('renders a settled diff even when the window dropped the call head', () => {
    // A truncated call carries only the result view, which holds the whole change.
    expect(diffCardModel(settled({ call: null, callView: null }))?.card.diffs).toHaveLength(1)
  })

  it('returns null for every non-diff call: no views, generic views, unknown cards', () => {
    expect(diffCardModel(running({ callView: null }))).toBeNull()
    expect(diffCardModel(settled({ callView: null, resultView: null }))).toBeNull()
    expect(diffCardModel(running({ callView: { card: 'generic', title: 'read x' } }))).toBeNull()
    // A generic result settles a diff call on the generic path (write/edit's
    // own execution-error arm).
    expect(diffCardModel(settled({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart', title: 'plot' } as unknown as ToolCallView
    expect(diffCardModel(running({ callView: future }))).toBeNull()
    expect(diffCardModel(settled({
      callView: future, resultView: { card: 'chart' } as unknown as ToolResultView,
    }))).toBeNull()
  })

  it('falls back to null for a malformed diff payload off the wire', () => {
    // toolEventViewSchema validates only the `card` string, so a version
    // mismatch can deliver a diff card with an unusable diffs field. Each shape
    // routes to the generic path instead of throwing inside DiffBlock.
    const bad = (diffs: unknown): ToolResultView => ({ card: 'diff', diffs } as unknown as ToolResultView)
    expect(diffCardModel(settled({ resultView: bad(undefined) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad('nope') }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([null]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([{ path: 1, oldText: null, newText: 'x' }]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([{ path: 'a', oldText: 5, newText: 'x' }]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([{ path: 'a', oldText: null, newText: 9 }]) }))).toBeNull()
    // The running side narrows identically.
    expect(diffCardModel(running({ callView: { card: 'diff', diffs: 'nope' } as unknown as ToolCallView }))).toBeNull()
  })
})
