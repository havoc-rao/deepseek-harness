// @vitest-environment jsdom
// The pure webCardModel derivation over the settled result view — the source
// the chat web row and the details panel both draw the citation list or
// fetched-source card from.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { webCardModel } from '../src/client/models/web-card-model.ts'

const SEARCH_ARGS = '{"query":"deepseek harness"}'
const FETCH_ARGS = '{"url":"https://example.com/page"}'

/** A web_search result view; overrides tune the sources / answer / truncation. */
const resultSearch = (over?: Partial<Extract<ToolResultView, { card: 'web'; kind: 'search' }>>): ToolResultView => ({
  card: 'web', kind: 'search', truncated: false,
  answer: 'A short answer.',
  sources: [
    { url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' },
    { url: 'https://plain.example.org/b' },
  ],
  ...over,
})

/** A web_fetch result view. */
const resultFetch = (over?: Partial<Extract<ToolResultView, { card: 'web'; kind: 'fetch' }>>): ToolResultView => ({
  card: 'web', kind: 'fetch', url: 'https://example.com/page', statusCode: 200, truncated: false, ...over,
})

const runningSearch = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'web_search', argsRaw: SEARCH_ARGS,
  turn: 1, step: 1, time: 1_000, callView: { card: 'generic', title: 'Search', kind: 'search' }, subCalls: [], ...over,
})

const settledSearch = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'web_search', argsRaw: SEARCH_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'search text' }], isError: false,
  callView: { card: 'generic', title: 'Search', kind: 'search' }, resultView: resultSearch(), subCalls: [], ...over,
})

const settledFetch = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 11, time: 2_000, callId: 'c2',
  call: { name: 'web_fetch', argsRaw: FETCH_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'fetch body' }], isError: false,
  callView: { card: 'generic', title: 'Fetch', kind: 'fetch' }, resultView: resultFetch(), subCalls: [], ...over,
})

describe('webCardModel', () => {
  it('derives a search card from the result view, projecting every source field', () => {
    expect(webCardModel(settledSearch())).toEqual({
      kind: 'search',
      answer: 'A short answer.',
      truncated: false,
      sources: [
        { url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' },
        { url: 'https://plain.example.org/b', title: undefined, snippet: undefined, publishedAt: undefined },
      ],
    })
  })

  it('carries the search truncation flag and an absent answer', () => {
    const model = webCardModel(settledSearch({ resultView: { card: 'web', kind: 'search', truncated: true, sources: [] } }))
    expect(model).toEqual({ kind: 'search', answer: undefined, truncated: true, sources: [] })
  })

  it('derives a fetch card from the result view', () => {
    expect(webCardModel(settledFetch())).toEqual({
      kind: 'fetch', url: 'https://example.com/page', statusCode: 200, truncated: false,
    })
    expect(webCardModel(settledFetch({ resultView: resultFetch({ statusCode: 404, truncated: true }) })))
      .toEqual({ kind: 'fetch', url: 'https://example.com/page', statusCode: 404, truncated: true })
  })

  it('returns null for a running call, since the web card is result-only', () => {
    expect(webCardModel(runningSearch())).toBeNull()
    // Even a running call that somehow carried a web call view stays generic:
    // the derivation reads resultView only.
    expect(webCardModel(runningSearch({ callView: null }))).toBeNull()
  })

  it('returns null for a settled call whose result view is not a web card', () => {
    expect(webCardModel(settledSearch({ resultView: null }))).toBeNull()
    expect(webCardModel(settledSearch({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart', kind: 'search' } as unknown as ToolResultView
    expect(webCardModel(settledSearch({ resultView: future }))).toBeNull()
    // A web card whose kind this UI version does not know (a newer host's
    // value) also takes the generic path, not a malformed fetch.
    const futureKind = { card: 'web', kind: 'timeline' } as unknown as ToolResultView
    expect(webCardModel(settledSearch({ resultView: futureKind }))).toBeNull()
  })
})
