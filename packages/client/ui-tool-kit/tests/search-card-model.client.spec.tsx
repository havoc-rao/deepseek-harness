// @vitest-environment jsdom
// The pure searchCardModel derivation — grep matches and glob paths cards off
// persisted result metadata, with the capped-result recovery arm.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { searchCardModel } from '../src/client/models/search-card-model.ts'

const GREP_ARGS = '{"pattern":"foo","path":"src"}'
const GLOB_ARGS = '{"pattern":"**/*.ts","path":"src"}'

interface MatchesMeta {
  shape: 'matches'
  files: { path: string; matches: { lineNumber: number; line: string }[] }[]
  truncated: boolean
  total: number
}

interface PathsMeta {
  shape: 'paths'
  paths: string[]
  truncated: boolean
  total: number
}

/** Persisted grep metadata: matches grouped by file. */
const matchesMeta = (over?: Partial<MatchesMeta>): MatchesMeta => ({
  shape: 'matches',
  files: [
    { path: 'a.ts', matches: [{ lineNumber: 12, line: 'const foo = 1' }, { lineNumber: 40, line: 'return foo' }] },
    { path: 'b.ts', matches: [{ lineNumber: 7, line: 'foo()' }] },
  ],
  truncated: false, total: 3, ...over,
})

/** Persisted glob metadata: a flat path list. */
const pathsMeta = (over?: Partial<PathsMeta>): PathsMeta => ({
  shape: 'paths', paths: ['src/a.ts', 'src/b.ts'], truncated: false, total: 2, ...over,
})

const runningGrep = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'grep', argsRaw: GREP_ARGS,
  turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

const settledGrep = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'grep', argsRaw: GREP_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'a.ts\n  Line 12: const foo = 1' }], isError: false,
  meta: matchesMeta(), subCalls: [], ...over,
})

const settledGlob = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 11, time: 2_000, callId: 'c2',
  call: { name: 'glob', argsRaw: GLOB_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'src/a.ts\nsrc/b.ts' }], isError: false,
  meta: pathsMeta(), subCalls: [], ...over,
})

describe('searchCardModel', () => {
  it('derives a matches card from grep result metadata', () => {
    expect(searchCardModel(settledGrep())).toEqual({
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

  it('derives a paths card from glob result metadata, carrying the truncation signal', () => {
    // Empty block content isolates the truncation signal from the recovery arm.
    expect(searchCardModel(settledGlob({ content: [], meta: pathsMeta({ truncated: true, total: 20 }) }))).toEqual({
      recovery: undefined,
      card: { kind: 'paths', paths: ['src/a.ts', 'src/b.ts'], truncated: true, total: 20 },
    })
  })

  it('returns null for running, missing calls, errors, malformed args, unrelated tools, and children', () => {
    expect(searchCardModel(runningGrep())).toBeNull()
    expect(searchCardModel(settledGrep({ call: null }))).toBeNull()
    expect(searchCardModel(settledGrep({ isError: true }))).toBeNull()
    expect(searchCardModel(settledGrep({ call: { name: 'grep', argsRaw: '{' } }))).toBeNull()
    expect(searchCardModel(settledGrep({ call: { name: 'echo', argsRaw: '{}' } }))).toBeNull()
    expect(searchCardModel(settledGrep({ parentCallId: 'parent' }))).toBeNull()
  })

  it('returns null for metadata whose shape does not match the tool', () => {
    expect(searchCardModel(settledGrep({ meta: { shape: 'future', truncated: false, total: 0 } }))).toBeNull()
    expect(searchCardModel(settledGrep({ meta: pathsMeta() }))).toBeNull()
    expect(searchCardModel(settledGlob({ meta: matchesMeta() }))).toBeNull()
  })

  it('validates declared search argument fields and accepts open-root extensions', () => {
    expect(searchCardModel(settledGrep({
      call: { name: 'grep', argsRaw: '{"pattern":"foo","include":7}' },
    }))).toBeNull()
    expect(searchCardModel(settledGrep({
      call: { name: 'grep', argsRaw: '{"pattern":"foo","include":"!*.ts"}' },
    }))).toBeNull()
    expect(searchCardModel(settledGlob({
      call: { name: 'glob', argsRaw: '{"pattern":"**/*.ts","path":7}' },
    }))).toBeNull()
    expect(searchCardModel(settledGrep({
      call: { name: 'grep', argsRaw: '{"pattern":"foo","extension":1}' },
    }))).not.toBeNull()
  })

  it('returns null for a known shape whose structured shape is missing or malformed', () => {
    const noFiles = { shape: 'matches', truncated: false, total: 0 }
    expect(searchCardModel(settledGrep({ meta: noFiles }))).toBeNull()
    const badFile = {
      shape: 'matches', truncated: false, total: 1,
      files: [{ path: 'a.ts', matches: [{ lineNumber: 'x', line: 1 }] }],
    }
    expect(searchCardModel(settledGrep({ meta: badFile }))).toBeNull()
    const noPaths = { shape: 'paths', truncated: false, total: 0 }
    expect(searchCardModel(settledGlob({ meta: noPaths }))).toBeNull()
    const badPaths = {
      shape: 'paths', truncated: false, total: 1, paths: [42],
    }
    expect(searchCardModel(settledGlob({ meta: badPaths }))).toBeNull()
  })

  it('surfaces the recovery text only when the result was capped', () => {
    const recovery = 'a.ts\n  12: const foo = 1\n\n(Full grep result stored at: spill://grep-1. Read it to see every match.)'
    // The recovery locator lives in raw tool/result content and is surfaced only
    // when metadata says the card was capped.
    const capped = searchCardModel(settledGrep({
      content: [{ type: 'text', text: recovery }],
      meta: matchesMeta({ truncated: true, total: 42 }),
    }))
    expect(capped?.recovery).toBe(recovery)
    // Not capped: the card holds every match, so the raw content adds nothing and
    // is dropped.
    const whole = searchCardModel(settledGrep({
      content: [{ type: 'text', text: recovery }],
      meta: matchesMeta({ truncated: false }),
    }))
    expect(whole?.recovery).toBeUndefined()
    // Capped but the block carries no text: nothing to surface.
    const noText = searchCardModel(settledGrep({ content: [], meta: matchesMeta({ truncated: true, total: 42 }) }))
    expect(noText?.recovery).toBeUndefined()
  })
})
