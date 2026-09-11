// @vitest-environment jsdom
// The pure readCardModel/readCallLine derivations — the settled read card the
// chat row and the details panel share, and the 1-based offset the path link
// opens at.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { readCallLine, readCardModel } from '../src/client/models/read-card-model.ts'

// The read tool's real schema key is `file_path`; `web_fetch` (below) has its
// own schema whose key is not `file_path`, so it keeps a `url`-less `path`.
const ARGS = '{"file_path":"src/a.ts","offset":41}'

/** Three windowed lines starting at file line 41 (a read past an offset). */
const sampleLines = [
  { number: 41, text: 'export const a = 1' },
  { number: 42, text: 'export const b = 2' },
  { number: 43, text: 'export const c = 3' },
]

interface ReadMetaFixture {
  path: string
  offset: number
  lines: { number: number; text: string }[]
  totalLines: number
  lang?: string
}

const readMeta = (over?: Partial<ReadMetaFixture>): ReadMetaFixture => ({
  path: 'src/a.ts', offset: 41, lines: sampleLines, totalLines: 180, lang: 'ts', ...over,
})

const readContent = (body = 'export const a = 1'): string => `<path>src/a.ts</path>\n<type>file</type>\n<content>\n${body}\n</content>`

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'read', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'read', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: readContent() }], isError: false,
  meta: readMeta(), subCalls: [], ...over,
})

describe('readCardModel', () => {
  it('derives the card from settled read metadata and its raw envelope', () => {
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

  it('relativizes a workspace-rooted path label, and leaves others as authored', () => {
    // A workspace-rooted absolute path shows its short form.
    expect(readCardModel(settled({ meta: readMeta({ path: '/w/app/src/a.ts' }) }), '/w/app')?.label)
      .toBe('src/a.ts')
    // A path outside the workspace stays as authored.
    expect(readCardModel(settled({ meta: readMeta({ path: '/srv/other.ts' }) }), '/w/app')?.label)
      .toBe('/srv/other.ts')
    // With no session cwd there is nothing to relativize against.
    expect(readCardModel(settled({ meta: readMeta({ path: '/w/app/src/a.ts' }) }))?.label)
      .toBe('/w/app/src/a.ts')
  })

  it('abbreviates a leftover POSIX home path label', () => {
    expect(readCardModel(settled({ meta: readMeta({ path: '/Users/u/notes.md' }) }), '/tmp/ws', '/Users/u')?.label)
      .toBe('~/notes.md')
    expect(readCardModel(settled({ meta: readMeta({ path: '/Users/u/app/src/a.ts' }) }), '/Users/u/app', '/Users/u')?.label)
      .toBe('src/a.ts')
    expect(readCardModel(settled({ meta: readMeta({ path: 'C:\\Users\\u\\a.ts' }) }), '/tmp/ws', '/Users/u')?.label)
      .toBe('C:\\Users\\u\\a.ts')
  })

  it('carries an omitted language through as undefined', () => {
    const noLang = readMeta()
    delete (noLang as { lang?: string }).lang
    expect(readCardModel(settled({ meta: noLang }))?.lang).toBeUndefined()
  })

  it('returns null for a running read: the read intent is result-side only', () => {
    // A read carries no content until execute returns, so the pending call is a
    // generic card and there is no read card to draw yet.
    expect(readCardModel(running())).toBeNull()
  })

  it('returns null for missing calls, errors, malformed metadata/envelopes, unrelated tools, and children', () => {
    expect(readCardModel(settled({ call: null }))).toBeNull()
    expect(readCardModel(settled({ isError: true }))).toBeNull()
    expect(readCardModel(settled({ meta: undefined }))).toBeNull()
    expect(readCardModel(settled({ meta: { ...readMeta(), lines: [{ number: 0, text: 'bad' }] } }))).toBeNull()
    expect(readCardModel(settled({ content: [{ type: 'text', text: 'plain result' }] }))).toBeNull()
    expect(readCardModel(settled({ call: { name: 'echo', argsRaw: '{}' } }))).toBeNull()
    expect(readCardModel(settled({ parentCallId: 'parent' }))).toBeNull()
  })

  it.each([
    ['missing file_path', '{}'],
    ['non-string file_path', '{"file_path":7}'],
    ['blank file_path', '{"file_path":" "}'],
    ['non-number offset', '{"file_path":"src/a.ts","offset":"41"}'],
    ['non-positive offset', '{"file_path":"src/a.ts","offset":0}'],
    ['fractional limit', '{"file_path":"src/a.ts","limit":1.5}'],
  ])('keeps malformed recognized read args generic: %s', (_label, argsRaw) => {
    expect(readCardModel(settled({ call: { name: 'read', argsRaw } }))).toBeNull()
  })

  it('accepts unknown fields because first-party parameter roots are open', () => {
    const argsRaw = JSON.stringify({ file_path: 'src/a.ts', offset: 41, extension: { version: 1 } })
    expect(readCardModel(settled({ call: { name: 'read', argsRaw } }))).not.toBeNull()
  })
})

describe('readCallLine', () => {
  it('reads the 1-based offset a well-formed read call started from, running or settled', () => {
    expect(readCallLine(running())).toBe(41)
    expect(readCallLine(settled())).toBe(41)
  })

  it.each([
    ['no offset', '{"file_path":"src/a.ts"}'],
    ['a string offset', '{"file_path":"src/a.ts","offset":"41"}'],
    ['zero', '{"file_path":"src/a.ts","offset":0}'],
    ['a negative offset', '{"file_path":"src/a.ts","offset":-3}'],
    ['a fraction', '{"file_path":"src/a.ts","offset":2.5}'],
    ['a read without a path', '{"offset":3}'],
  ])('names no line for %s', (_label, argsRaw) => {
    expect(readCallLine(running({ argsRaw }))).toBeUndefined()
  })

  it('names no line for a call that is not read', () => {
    expect(readCallLine(running({ name: 'echo', argsRaw: '{"offset":3}' }))).toBeUndefined()
  })
})
