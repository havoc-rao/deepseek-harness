// @vitest-environment jsdom
// The pure diffCardModel derivation — the single source both the chat row and
// the details panel draw the applied diff from.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { diffCardModel } from '../src/client/models/diff-card-model.ts'

const ARGS = '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}'

const DIFFS = [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }]

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'edit', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'edit', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'The file notes/demo.txt has been updated successfully.' }], isError: false,
  meta: { diffs: DIFFS }, subCalls: [], ...over,
})

describe('diffCardModel', () => {
  it('derives a running card from raw edit arguments', () => {
    expect(diffCardModel(running())).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }] },
    })
  })

  it('preserves the Host presenter\'s whole-file diff for an empty old_string', () => {
    expect(diffCardModel(running({
      argsRaw: '{"file_path":"notes/demo.txt","old_string":"","new_string":"replacement"}',
    }))).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: null, newText: 'replacement' }] },
    })
  })

  it.each([
    {
      command: 'create',
      args: { command: 'create', path: 'notes/new.txt', file_text: 'new file\n' },
      diff: { path: 'notes/new.txt', oldText: null, newText: 'new file\n' },
    },
    {
      command: 'str_replace',
      args: { command: 'str_replace', path: 'notes/demo.txt', old_str: 'old', new_str: 'new' },
      diff: { path: 'notes/demo.txt', oldText: 'old', newText: 'new' },
    },
  ])('preserves the running str_replace_editor $command diff', ({ args, diff }) => {
    expect(diffCardModel(running({
      name: 'str_replace_editor',
      argsRaw: JSON.stringify(args),
    }))).toEqual({ card: { diffs: [diff] } })
  })

  it('preserves str_replace_editor defaults and its settled Generic result', () => {
    const argsRaw = JSON.stringify({ command: 'str_replace', path: 'notes/demo.txt' })
    expect(diffCardModel(running({ name: 'str_replace_editor', argsRaw }))).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: null, newText: '' }] },
    })
    expect(diffCardModel(settled({
      call: { name: 'str_replace_editor', argsRaw },
      meta: { diffs: [{ path: 'notes/demo.txt', oldText: 'old', newText: 'new' }] },
    }))).toBeNull()
  })

  it('keeps unsupported or malformed str_replace_editor calls generic', () => {
    const editor = (args: Record<string, unknown>) => running({
      name: 'str_replace_editor', argsRaw: JSON.stringify(args),
    })
    expect(diffCardModel(editor({ command: 'view', path: 'notes/demo.txt' }))).toBeNull()
    expect(diffCardModel(editor({ command: 'insert', path: 'notes/demo.txt', new_str: 'x' }))).toBeNull()
    expect(diffCardModel(editor({ command: 'create', path: '', file_text: 'x' }))).toBeNull()
    expect(diffCardModel(editor({ command: 'create', path: 'notes/demo.txt', file_text: 1 }))).toBeNull()
    expect(diffCardModel(editor({ command: 'str_replace', path: 'notes/demo.txt', old_str: 1 }))).toBeNull()
    expect(diffCardModel(editor({ command: 'str_replace', path: 'notes/demo.txt', new_str: 1 }))).toBeNull()
  })

  it('derives a settled card from result metadata, which replaces the intended diff', () => {
    expect(diffCardModel(settled({
      meta: { diffs: [{ path: 'notes/demo.txt', oldText: 'a', newText: 'b' }] },
    }))).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'a', newText: 'b' }] },
    })
  })

  it('uses the intended write diff when successful metadata reports no applied hunk', () => {
    const writeArgs = JSON.stringify({ file_path: 'notes/new.txt', content: 'hello fixture\n' })
    expect(diffCardModel(settled({
      call: { name: 'write', argsRaw: writeArgs },
      meta: { diffs: [] },
    }))).toEqual({
      card: { diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture\n' }] },
    })
  })

  it('returns null for missing calls, errors, malformed args, unrelated tools, and child dispatches', () => {
    expect(diffCardModel(settled({ call: null }))).toBeNull()
    expect(diffCardModel(settled({ isError: true }))).toBeNull()
    expect(diffCardModel(running({ argsRaw: '{' }))).toBeNull()
    expect(diffCardModel(running({ name: 'read' }))).toBeNull()
    expect(diffCardModel(running({ parentCallId: 'parent' }))).toBeNull()
    expect(diffCardModel(settled({ parentCallId: 'parent' }))).toBeNull()
  })

  it('keeps edit generic for missing or malformed applied metadata', () => {
    expect(diffCardModel(settled({ meta: undefined }))).toBeNull()
    expect(diffCardModel(settled({ meta: null }))).toBeNull()
    expect(diffCardModel(settled({ meta: { diffs: 'nope' } }))).toBeNull()
    expect(diffCardModel(settled({ meta: { diffs: [null] } }))).toBeNull()
    expect(diffCardModel(settled({ meta: { diffs: [{ path: 1, oldText: null, newText: 'x' }] } }))).toBeNull()
    expect(diffCardModel(settled({ meta: { diffs: [{ path: 'a', oldText: 5, newText: 'x' }] } }))).toBeNull()
    expect(diffCardModel(settled({ meta: { diffs: [{ path: 'a', oldText: null, newText: 9 }] } }))).toBeNull()
  })

  it.each([
    undefined,
    null,
    { diffs: 'nope' },
    { diffs: [null] },
  ])('uses the intended write diff when applied metadata is absent or malformed: %j', (meta) => {
    const writeArgs = JSON.stringify({ file_path: 'notes/new.txt', content: 'hello fixture\n' })
    expect(diffCardModel(settled({
      call: { name: 'write', argsRaw: writeArgs },
      meta,
    }))).toEqual({
      card: { diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture\n' }] },
    })
  })

  it('validates mutation escalation fields but accepts unrelated open-root fields', () => {
    const args = (fields: Record<string, unknown>) => JSON.stringify({
      file_path: 'notes/demo.txt', old_string: 'hello', new_string: 'hello fixture', ...fields,
    })
    expect(diffCardModel(running({ argsRaw: args({ sandbox_permissions: 7, justification: 'Need access' }) }))).toBeNull()
    expect(diffCardModel(running({ argsRaw: args({ sandbox_permissions: 'workspace-write' }) }))).toBeNull()
    expect(diffCardModel(running({ argsRaw: args({ extension: { version: 1 } }) }))).not.toBeNull()
  })
})
