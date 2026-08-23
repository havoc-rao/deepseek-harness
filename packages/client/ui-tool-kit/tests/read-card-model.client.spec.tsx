// @vitest-environment jsdom
// The pure readCardModel derivation over the settled result view — the source
// the chat read row and the details panel both draw the windowed file from.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { readCardModel } from '../src/client/models/read-card-model.ts'

const ARGS = '{"file_path":"src/a.ts","offset":41}'

/** Three windowed lines starting at file line 41 (a read past an offset). */
const sampleLines = [
  { number: 41, text: 'export const a = 1' },
  { number: 42, text: 'export const b = 2' },
  { number: 43, text: 'export const c = 3' },
]

/** The read tool's own result view for a settled file read. */
const resultRead = (over?: Partial<Extract<ToolResultView, { card: 'read' }>>): ToolResultView => ({
  card: 'read', path: 'src/a.ts', offset: 41, lines: sampleLines, totalLines: 180, lang: 'ts', ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'read', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Read src/a.ts', kind: 'read' }, subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'read', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: '41: export const a = 1' }], isError: false,
  callView: { card: 'generic', title: 'Read src/a.ts', kind: 'read' }, resultView: resultRead(), subCalls: [], ...over,
})

describe('readCardModel', () => {
  it('derives the card from a settled read result view', () => {
    expect(readCardModel(settled())).toEqual({
      label: 'src/a.ts', lines: sampleLines, totalLines: 180, lang: 'ts',
    })
  })

  it('copies the lines into the primitive shape rather than aliasing the frozen slice', () => {
    const model = readCardModel(settled())
    expect(model?.lines).toEqual(sampleLines)
    expect(model?.lines).not.toBe(sampleLines)
    expect(model?.lines[0]).not.toBe(sampleLines[0])
  })

  it('takes the result view\'s replacement title over the relativized path', () => {
    // The presentation contract defines a result title as REPLACING the pending
    // one, so a tool that supplies a label wins over the path here.
    expect(readCardModel(settled({ resultView: resultRead({ title: 'Read (head) src/a.ts' }) }))?.label)
      .toBe('Read (head) src/a.ts')
  })

  it('relativizes a workspace-rooted path label, and leaves others as authored', () => {
    // A workspace-rooted absolute path shows its short form.
    expect(readCardModel(settled({ resultView: resultRead({ path: '/w/app/src/a.ts' }) }), '/w/app')?.label)
      .toBe('src/a.ts')
    // A path outside the workspace stays as authored.
    expect(readCardModel(settled({ resultView: resultRead({ path: '/srv/other.ts' }) }), '/w/app')?.label)
      .toBe('/srv/other.ts')
    // With no session cwd there is nothing to relativize against.
    expect(readCardModel(settled({ resultView: resultRead({ path: '/w/app/src/a.ts' }) }))?.label)
      .toBe('/w/app/src/a.ts')
  })

  it('abbreviates a leftover POSIX home path label', () => {
    expect(readCardModel(settled({ resultView: resultRead({ path: '/Users/u/notes.md' }) }), '/tmp/ws', '/Users/u')?.label)
      .toBe('~/notes.md')
    expect(readCardModel(settled({ resultView: resultRead({ path: '/Users/u/app/src/a.ts' }) }), '/Users/u/app', '/Users/u')?.label)
      .toBe('src/a.ts')
    expect(readCardModel(settled({ resultView: resultRead({ path: 'C:\\Users\\u\\a.ts' }) }), '/tmp/ws', '/Users/u')?.label)
      .toBe('C:\\Users\\u\\a.ts')
  })

  it('carries an omitted language through as undefined', () => {
    const noLang = resultRead()
    delete (noLang as { lang?: string }).lang
    expect(readCardModel(settled({ resultView: noLang }))?.lang).toBeUndefined()
  })

  it('returns null for a running read: the read intent is result-side only', () => {
    // A read carries no content until execute returns, so the pending call is a
    // generic card and there is no read card to draw yet.
    expect(readCardModel(running())).toBeNull()
  })

  it('returns null for every non-read settled call: no view, generic view, unknown card', () => {
    expect(readCardModel(settled({ resultView: null }))).toBeNull()
    expect(readCardModel(settled({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart' } as unknown as ToolResultView
    expect(readCardModel(settled({ resultView: future }))).toBeNull()
  })
})
