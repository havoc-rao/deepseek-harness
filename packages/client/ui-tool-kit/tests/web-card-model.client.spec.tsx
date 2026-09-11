// @vitest-environment jsdom
// The pure webCardModel derivation — search and fetch cards off persisted
// result metadata; the web card is result-only.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { webCardModel } from '../src/client/models/web-card-model.ts'

const SEARCH_ARGS = '{"queries":["deepseek harness"]}'
const FETCH_ARGS = '{"url":"https://example.com/page"}'

interface SearchMeta {
  sources: { url: string; title?: string; snippet?: string; publishedAt?: string }[]
  truncated: boolean
  answer?: string
}

interface FetchMeta {
  url: string
  statusCode: number
  truncated: boolean
}

/** Persisted web_search result metadata. */
const searchMeta = (over?: Partial<SearchMeta>): SearchMeta => ({
  truncated: false,
  answer: 'A short answer.',
  sources: [
    { url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' },
    { url: 'https://plain.example.org/b' },
  ],
  ...over,
})

/** Persisted web_fetch result metadata. */
const fetchMeta = (over?: Partial<FetchMeta>): FetchMeta => ({
  url: 'https://example.com/page', statusCode: 200, truncated: false, ...over,
})

const runningSearch = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'web_search', argsRaw: SEARCH_ARGS,
  turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

const settledSearch = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'web_search', argsRaw: SEARCH_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'search text' }], isError: false,
  meta: searchMeta(), subCalls: [], ...over,
})

const settledFetch = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 11, time: 2_000, callId: 'c2',
  call: { name: 'web_fetch', argsRaw: FETCH_ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'fetch body' }], isError: false,
  meta: fetchMeta(), subCalls: [], ...over,
})

describe('webCardModel', () => {
  it('derives a search card from result metadata, projecting every source field', () => {
    expect(webCardModel(settledSearch())).toEqual({
      kind: 'search',
      answer: 'A short answer.',
      truncated: false,
      sources: [
        { url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' },
        { url: 'https://plain.example.org/b' },
      ],
    })
  })

  it('carries the search truncation flag and an absent answer', () => {
    const model = webCardModel(settledSearch({ meta: { truncated: true, sources: [] } }))
    expect(model).toEqual({ kind: 'search', answer: undefined, truncated: true, sources: [] })
  })

  it('derives a fetch card from result metadata', () => {
    expect(webCardModel(settledFetch())).toEqual({
      kind: 'fetch', url: 'https://example.com/page', statusCode: 200, truncated: false,
    })
    expect(webCardModel(settledFetch({ meta: fetchMeta({ statusCode: 404, truncated: true }) })))
      .toEqual({ kind: 'fetch', url: 'https://example.com/page', statusCode: 404, truncated: true })
  })

  it('returns null for a running call, since the web card is result-only', () => {
    expect(webCardModel(runningSearch())).toBeNull()
  })

  it('returns null for missing calls, errors, malformed args/meta, unrelated tools, and children', () => {
    expect(webCardModel(settledSearch({ call: null }))).toBeNull()
    expect(webCardModel(settledSearch({ isError: true }))).toBeNull()
    expect(webCardModel(settledSearch({ call: { name: 'web_search', argsRaw: '{' } }))).toBeNull()
    expect(webCardModel(settledSearch({ meta: undefined }))).toBeNull()
    expect(webCardModel(settledSearch({ meta: { sources: [], truncated: 'yes' } }))).toBeNull()
    expect(webCardModel(settledSearch({ call: { name: 'echo', argsRaw: '{}' } }))).toBeNull()
    expect(webCardModel(settledSearch({ parentCallId: 'parent' }))).toBeNull()
  })

  it('accepts open-root extensions while validating declared web arguments', () => {
    expect(webCardModel(settledSearch({
      call: { name: 'web_search', argsRaw: '{"queries":["deepseek"],"extension":1}' },
    }))).not.toBeNull()
    expect(webCardModel(settledSearch({
      call: { name: 'web_search', argsRaw: '{"queries":[7]}' },
    }))).toBeNull()
    expect(webCardModel(settledFetch({
      call: { name: 'web_fetch', argsRaw: '{"url":" "}' },
    }))).toBeNull()
  })
})
