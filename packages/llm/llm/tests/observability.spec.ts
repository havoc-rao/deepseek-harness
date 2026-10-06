import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Operation, Outcome } from '@deepseek-ai/dsh-observability-otel'
import LlmRuntime, { LlmAdapter, LlmError } from '../src/index.ts'
import type { GenerateOptions, StreamChunk } from '../src/index.ts'

const OWNER = '@deepseek-ai/dsh-test-adapter'
const request: GenerateOptions = { provider: 'route', model: 'private-model', messages: [] }
const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

class Adapter extends LlmAdapter {
  constructor(private readonly generate: () => AsyncIterable<StreamChunk>) { super() }
  stream(): AsyncIterable<StreamChunk> { return this.generate() }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  const active = new AsyncLocalStorage<number>()
  const records: { owner: string; operation: string; outcomes: Outcome[] }[] = []
  ctx.provide('observability', {
    start(owner: string, operation: string): Operation {
      const record = { owner, operation, outcomes: [] as Outcome[] }
      records.push(record)
      const id = records.length
      return {
        spanContext: undefined,
        with: fn => active.run(id, fn),
        end: (outcome = 'success') => { record.outcomes.push(outcome) },
      }
    },
  })
  return { ctx, records, active }
}

describe('registration-bound LLM observation', () => {
  it('skips missing owners and starts only when a registered stream is pulled', async () => {
    const { ctx, records } = await setup()
    const adapter = new Adapter(async function* () { yield finish })
    const handle = ctx.llm.registerAdapter(['route'], adapter)
    await collect(ctx.llm.stream(request))
    expect(records).toEqual([])
    handle()
    ctx.llm.registerAdapter(['route'], adapter, { telemetryOwner: OWNER })
    const stream = ctx.llm.stream(request)
    expect(records).toEqual([])
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.return?.()
    expect(records).toEqual([])
    await collect(ctx.llm.stream(request))
    expect(records).toEqual([{ owner: OWNER, operation: 'llm.stream.route', outcomes: ['success'] }])
  })

  it('pins prepared owners and preserves owner metadata on replacement', async () => {
    const { ctx, records } = await setup()
    const adapter = new Adapter(async function* () { yield finish })
    const options = { telemetryOwner: OWNER }
    const registration = ctx.llm.registerAdapter(['route'], adapter, options)
    options.telemetryOwner = 'not-the-owner'
    registration.replace(['route'])
    const prepared = await ctx.llm.prepareCall(request)
    registration()
    ctx.llm.registerAdapter(['route'], adapter, { telemetryOwner: 'replacement-owner' })
    await collect(prepared.stream(request))
    expect(records[0]?.owner).toBe(OWNER)
    await collect(ctx.llm.stream(request))
    expect(records[1]?.owner).toBe('replacement-owner')
  })

  it.each(['error', 'aborted'] as const)('classifies emitted %s finishes', async (kind) => {
    const { ctx, records } = await setup()
    const chunk: StreamChunk = { type: 'finish', reason: { kind, failure: { code: 'TEST', message: 'private-error' } } }
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () { yield chunk }), { telemetryOwner: OWNER })
    expect(await collect(ctx.llm.stream(request))).toEqual([chunk])
    expect(records[0]?.outcomes).toEqual([kind === 'error' ? 'error' : 'cancelled'])
  })

  it.each(['prepare', 'iteration'] as const)('preserves normalized %s failures', async (phase) => {
    const { ctx, records } = await setup()
    const failure = new LlmError('private-error', 'TEST')
    const adapter = new Adapter(async function* () { throw failure })
    if (phase === 'prepare') adapter.prepareCall = () => Promise.reject(failure)
    ctx.llm.registerAdapter(['route'], adapter, { telemetryOwner: OWNER })
    expect(await collect(ctx.llm.stream(request))).toEqual([
      { type: 'finish', reason: { kind: 'error', failure: failure.failure } },
    ])
    expect(records[0]?.outcomes).toEqual(['error'])
  })

  it.each([false, true])('ends after early-break cleanup, cleanup throws: %s', async (throws) => {
    const { ctx, records, active } = await setup()
    const failure = new Error('cleanup')
    let cleaned = false
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () {
      try {
        yield { type: 'text-delta', text: 'private', index: 0 }
      } finally {
        await Promise.resolve()
        expect(active.getStore()).toBe(1)
        expect(records[0]?.outcomes).toEqual([])
        cleaned = true
        if (throws) throw failure
      }
    }), { telemetryOwner: OWNER })
    const consume = async () => { for await (const _chunk of ctx.llm.stream(request)) break }
    if (throws) await expect(consume()).rejects.toBe(failure)
    else await consume()
    expect(cleaned).toBe(true)
    expect(records[0]?.outcomes).toEqual([throws ? 'error' : 'cancelled'])
    expect(active.getStore()).toBeUndefined()
  })

  it('classifies normalized timeout failures without changing the finish chunk', async () => {
    const { ctx, records } = await setup()
    const failure = new LlmError('private-timeout', 'TIMEOUT')
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () { throw failure }), { telemetryOwner: OWNER })
    expect(await collect(ctx.llm.stream(request))).toEqual([
      { type: 'finish', reason: { kind: 'error', failure: failure.failure } },
    ])
    expect(records[0]?.outcomes).toEqual(['timeout'])
  })

  it('streams normally when the optional observability service is absent', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () { yield finish }), { telemetryOwner: OWNER })
    expect(await collect(ctx.llm.stream(request))).toEqual([finish])
  })

  it('does not observe middleware that short-circuits the adapter', async () => {
    const { ctx, records } = await setup()
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () { throw new Error('not reached') }), { telemetryOwner: OWNER })
    ctx.on('llm/stream', async function* () { yield finish })
    expect(await collect(ctx.llm.stream(request))).toEqual([finish])
    expect(records).toEqual([])
  })

  it('preserves a consumer-injected exception and cleans up in the operation context', async () => {
    const { ctx, records, active } = await setup()
    let cleaned = false
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () {
      try { yield { type: 'text-delta', index: 0, text: 'private' } }
      finally { expect(active.getStore()).toBe(1); cleaned = true }
    }), { telemetryOwner: OWNER })
    const iterator = ctx.llm.stream(request)[Symbol.asyncIterator]()
    await iterator.next()
    const failure = new Error('consumer defect')
    await expect(iterator.throw!(failure)).rejects.toBe(failure)
    expect(cleaned).toBe(true)
    expect(records[0]?.outcomes).toEqual(['error'])
  })

  it('retains an emitted terminal outcome when the consumer breaks at finish', async () => {
    const { ctx, records } = await setup()
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () { yield finish }), { telemetryOwner: OWNER })
    for await (const _chunk of ctx.llm.stream(request)) break
    expect(records[0]?.outcomes).toEqual(['success'])
  })

  it('keeps concurrent iterator continuations isolated', async () => {
    const { ctx, records, active } = await setup()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    let entered = 0
    const seen: number[] = []
    ctx.llm.registerAdapter(['route'], new Adapter(async function* () {
      const id = active.getStore()!
      if (++entered === 2) release()
      await barrier
      expect(active.getStore()).toBe(id)
      seen.push(id)
      yield finish
      expect(active.getStore()).toBe(id)
    }), { telemetryOwner: OWNER })
    await Promise.all([collect(ctx.llm.stream(request)), collect(ctx.llm.stream(request))])
    expect(seen.sort()).toEqual([1, 2])
    expect(records.map(record => record.outcomes)).toEqual([['success'], ['success']])
    expect(active.getStore()).toBeUndefined()
  })
})
