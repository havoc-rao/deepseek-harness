// @vitest-environment jsdom
// The pure searchCardModel derivation over the settled result view — the source
// the chat search row and the details panel both draw grouped matches or a
// flat path list from.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { searchCardModel } from '../src/client/models/search-card-model.ts'

const GREP_ARGS = '{"pattern":"foo","path":"src"}'
const GLOB_ARGS = '{"pattern":"**/*.ts","path":"src"}'

/** A grep result view: matches grouped by file. */
const resultMatches = (over?: Partial<Extract<ToolResultView, { card: 'search'; shape: 'matches' }>>): ToolResultView => ({
  card: 'search', shape: 'matches',
  files: [
    { path: 'a.ts', matches: [{ lineNumber: 12, line: 'const foo = 1' }, { lineNumber: 40, line: 'return foo' }] },
    { path: 'b.ts', matches: [{ lineNumber: 7, line: 'foo()' }] },
  ],
  truncated: false, total: 3, ...over,
})

/** A glob result view: a flat path list. */
const resultPaths = (over?: Partial<Extract<ToolResultView, { card: 'search'; shape: 'paths' }>>): ToolResultView => ({
  card: 'search', shape: 'paths', paths: ['src/a.ts', 'src/b.ts'], truncated: false, total: 2, ...over,
})

const runningGrep = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'grep', argsRaw: GREP_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Grep foo', kind: 'search' }, subCalls: [], ...over,
})

const settledGrep = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'grep', argsRaw: GREP_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'a.ts\n  Line 12: const foo = 1' }], isError: false,
  callView: { card: 'generic', title: 'Grep foo', kind: 'search' }, resultView: resultMatches(), subCalls: [], ...over,
})

const settledGlob = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 11, time: 2_000, callId: 'c2',
  call: { name: 'glob', argsRaw: GLOB_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts' }], isError: false,
  callView: { card: 'generic', title: 'Glob **/*.ts', kind: 'search' }, resultView: resultPaths(), subCalls: [], ...over,
})

describe('searchCardModel', () => {
  it('derives a matches card from the grep result view', () => {
    expect(searchCardModel(settledGrep())).toEqual({
      title: undefined,
      recovery: undefined,
      card: {
        kind: 'matches',
        files: [
          { path: 'a.ts', matches: [{ lineNumber: 12, line: 'const foo = 1' }, { lineNumber: 40, line: 'return foo' }] },
          { path: 'b.ts', matches: [{ lineNumber: 7, line: 'foo()' }] },
        ],
        truncated: false, total: 3,
      },
    })
  })

  it('derives a paths card from the glob result view, carrying the truncation signal', () => {
    // Empty block content isolates the truncation signal from the recovery arm.
    expect(searchCardModel(settledGlob({ content: [], resultView: resultPaths({ truncated: true, total: 20 }) }))).toEqual({
      title: undefined,
      recovery: undefined,
      card: { kind: 'paths', paths: ['src/a.ts', 'src/b.ts'], truncated: true, total: 20 },
    })
  })

  it('carries the result view\'s replacement title when the presenter sets one', () => {
    expect(searchCardModel(settledGrep({ resultView: resultMatches({ title: '3 matches' }) }))?.title).toBe('3 matches')
    // Without one it is absent, so the row keeps its args-derived summary.
    expect(searchCardModel(settledGrep())?.title).toBeUndefined()
  })

  it('returns null for every non-search call: running, no views, generic, terminal, unknown cards', () => {
    // A search card is result-time only: a running call has no result view yet.
    expect(searchCardModel(runningGrep())).toBeNull()
    expect(searchCardModel(settledGrep({ callView: null, resultView: null }))).toBeNull()
    // A generic result settles a search call as a generic card (grep/glob failure
    // or a nested run_code dispatch), which keeps the generic path.
    expect(searchCardModel(settledGrep({ resultView: { card: 'generic' } }))).toBeNull()
    // A terminal result view is a different card entirely.
    expect(searchCardModel(settledGrep({ resultView: { card: 'terminal', output: 'x' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart' } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: future }))).toBeNull()
  })

  it('returns null for a card:search view whose shape this version does not compile', () => {
    // `shape` rides the same untrusted wire frame as `card`; a subtype this client
    // does not know must fall to the generic path, never render as a paths card
    // that would crash SearchBlock on an absent `paths`.
    const futureShape = {
      card: 'search', shape: 'future', truncated: false, total: 0,
    } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: futureShape }))).toBeNull()
  })

  it('returns null for a known shape whose structured shape is missing or malformed', () => {
    // The host wire schema checks the `card`/`shape` strings but not the grouped
    // shape, so a version mismatch could deliver shape:'matches' with no `files`
    // (or shape:'paths' with no `paths`). Rendering that crashes SearchBlock at
    // `.reduce`/`.map`; the derivation drops to the generic path instead.
    const noFiles = { card: 'search', shape: 'matches', truncated: false, total: 0 } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: noFiles }))).toBeNull()
    const badFile = {
      card: 'search', shape: 'matches', truncated: false, total: 1,
      files: [{ path: 'a.ts', matches: [{ lineNumber: 'x', line: 1 }] }],
    } as unknown as ToolResultView
    expect(searchCardModel(settledGrep({ resultView: badFile }))).toBeNull()
    const noPaths = { card: 'search', shape: 'paths', truncated: false, total: 0 } as unknown as ToolResultView
    expect(searchCardModel(settledGlob({ resultView: noPaths }))).toBeNull()
    const badPaths = {
      card: 'search', shape: 'paths', truncated: false, total: 1, paths: [42],
    } as unknown as ToolResultView
    expect(searchCardModel(settledGlob({ resultView: badPaths }))).toBeNull()
  })

  it('surfaces the recovery text only when the result was capped', () => {
    const recovery = 'a.ts\n  12: const foo = 1\n\n(Full grep result stored at: spill://grep-1. Read it to see every match.)'
    // The recovery locator lives in the raw tool/result content (the view carries
    // no text), surfaced only when the card capped the result.
    const capped = searchCardModel(settledGrep({
      content: [{ type: 'text', text: recovery }],
      resultView: resultMatches({ truncated: true, total: 42 }),
    }))
    expect(capped?.recovery).toBe(recovery)
    // Not capped: the card holds every match, so the raw content adds nothing and
    // is dropped.
    const whole = searchCardModel(settledGrep({
      content: [{ type: 'text', text: recovery }],
      resultView: resultMatches({ truncated: false }),
    }))
    expect(whole?.recovery).toBeUndefined()
    // Capped but the block carries no text: nothing to surface.
    const noText = searchCardModel(settledGrep({ content: [], resultView: resultMatches({ truncated: true, total: 42 }) }))
    expect(noText?.recovery).toBeUndefined()
  })
})
