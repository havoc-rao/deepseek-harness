import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { ownerPeer } from './peer.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, PeerScope } from '@deepseek-ai/dsh-client-connection'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Observability, { type Operation, type Outcome } from '@deepseek-ai/dsh-observability-otel'
import Gateway from '../src/index.ts'

interface RecordEntry {
  owner: string
  name: string
  outcomes: Outcome[]
}

class RecordingObservability extends Observability {
  readonly records: RecordEntry[] = []

  override start(owner: string, name: string): Operation {
    const record: RecordEntry = { owner, name, outcomes: [] }
    this.records.push(record)
    return {
      spanContext: undefined,
      with: fn => fn(),
      end: (outcome = 'success') => { record.outcomes.push(outcome) },
    }
  }
}

class Carrier extends Service {
  handler: ConnectionRpcHandler | undefined
  readonly operator: PeerScope
  constructor(ctx: Context) {
    super(ctx, 'connection')
    this.operator = ownerPeer(ctx)
  }
  get rpc() {
    return {
      intercept: (_channel: string, _matches: (endpoint: string) => boolean, handler: ConnectionRpcHandler) =>
        this.ctx.effect(() => {
          this.handler = handler
          return () => { this.handler = undefined }
        }),
    }
  }
}

class Fixture extends TypertRemoteService {
  failure: Error | undefined
  source: Iterable<string> | AsyncIterable<string> = ['one', 'two']

  constructor(ctx: Context) { super(ctx, 'observationFixture') }

  @Remote
  value(): string {
    if (this.failure !== undefined) throw this.failure
    return 'private payload'
  }

  @Remote({ mode: 'stream' })
  items(): Iterable<string> | AsyncIterable<string> {
    if (this.failure !== undefined) throw this.failure
    return this.source
  }
}

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function setup(): Promise<{ ctx: Context; fixture: Fixture; observer: RecordingObservability }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(RecordingObservability)
  await ctx.plugin(Fixture)
  await ctx.plugin(Gateway)
  return {
    ctx,
    fixture: ctx.get('observationFixture') as Fixture,
    observer: ctx.observability as RecordingObservability,
  }
}

const request = { namespace: 'observationFixture', method: 'items', args: {} }

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = []
  for await (const item of source) result.push(item)
  return result
}

describe('Gateway component observations', () => {
  it('settles unary results and preserves business error identity without payload attributes', async () => {
    const { ctx, fixture, observer } = await setup()
    expect(await ctx.typertGateway.invoke({ ...request, peer: ownerPeer(ctx), method: 'value' })).toBe('private payload')
    fixture.failure = new Error('private error')
    await expect(ctx.typertGateway.invoke({ ...request, peer: ownerPeer(ctx), method: 'value' })).rejects.toBe(fixture.failure)
    expect(observer.records).toEqual([
      { owner: '@deepseek-ai/dsh-api-gateway', name: 'gateway.invoke observationFixture/value', outcomes: ['success'] },
      { owner: '@deepseek-ai/dsh-api-gateway', name: 'gateway.invoke observationFixture/value', outcomes: ['error'] },
    ])
  })

  it('observes the Connection RPC carrier without replacing response envelopes', async () => {
    const { ctx, fixture, observer } = await setup()
    let carrier!: Carrier
    await ctx.plugin((inner) => { carrier = new Carrier(inner) })
    expect(await carrier.handler!('observationFixture/value', { args: {} }, new AbortController().signal, carrier.operator))
      .toEqual({ ok: true, value: 'private payload' })
    fixture.failure = new Error('business failure')
    expect(await carrier.handler!('observationFixture/value', { args: {} }, new AbortController().signal, carrier.operator))
      .toMatchObject({ ok: false, error: { code: 'gateway/internal' } })
    expect(observer.records.map(record => record.outcomes)).toEqual([['success'], ['error']])
  })

  it('does not collect unrecognized endpoint names', async () => {
    const { ctx, observer } = await setup()
    await expect(ctx.typertGateway.invoke({ ...request, peer: ownerPeer(ctx), method: 'untrusted-input' })).rejects.toThrow()
    expect(observer.records).toEqual([])
  })

  it('opens without retaining an observation until consumption begins', async () => {
    const { ctx, observer } = await setup()
    const stream = await ctx.typertGateway.stream({ ...request, peer: ownerPeer(ctx) })
    expect(observer.records.map(record => record.outcomes)).toEqual([['success']])
    expect(await collect(stream)).toEqual(['one', 'two'])
    expect(observer.records.map(record => [record.name, record.outcomes])).toEqual([
      ['gateway.stream.open observationFixture/items', ['success']],
      ['gateway.stream observationFixture/items', ['success']],
    ])
  })

  it('observes wire carrier consumption and early return once', async () => {
    const { ctx, observer } = await setup()
    const stream = await ctx.typertGateway.wireStream.open(
      'observationFixture/items', { args: {} }, (async function* () {})(), ownerPeer(ctx), new AbortController().signal,
    )
    for await (const item of stream) { expect(item).toBe('one'); break }
    expect(observer.records.map(record => record.outcomes)).toEqual([['success'], ['cancelled']])
  })

  it('settles a synchronous stream method failure', async () => {
    const { ctx, fixture, observer } = await setup()
    fixture.failure = new Error('factory failed')
    await expect(ctx.typertGateway.stream({ ...request, peer: ownerPeer(ctx) })).rejects.toBe(fixture.failure)
    expect(observer.records.map(record => record.outcomes)).toEqual([['error']])
  })

  it('settles iterator construction and cleanup failures', async () => {
    const { ctx, fixture, observer } = await setup()
    const failure = new Error('iterator failed')
    fixture.source = { [Symbol.iterator]() { throw failure } }
    await expect(collect(await ctx.typertGateway.stream({ ...request, peer: ownerPeer(ctx) }))).rejects.toBe(failure)
    fixture.source = { [Symbol.iterator]: () => ({ next: () => ({ done: true, value: undefined }), return: () => { throw failure } }) }
    await expect(collect(await ctx.typertGateway.stream({ ...request, peer: ownerPeer(ctx) }))).rejects.toBe(failure)
    expect(observer.records.map(record => record.outcomes)).toEqual([['success'], ['error'], ['success'], ['error']])
  })

  it('keeps cancellation active until pending iterator cleanup settles', async () => {
    const { ctx, fixture, observer } = await setup()
    const reading = Promise.withResolvers<undefined>()
    const cleanup = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<IteratorResult<string>>()
    fixture.source = {
      [Symbol.asyncIterator]: () => ({
        next: () => { reading.resolve(undefined); return release.promise },
        return: async () => { await cleanup.promise; return { done: true, value: undefined } },
      }),
    }
    const control = new AbortController()
    const stream = await ctx.typertGateway.stream({ ...request, peer: ownerPeer(ctx), signal: control.signal })
    const result = collect(stream)
    const rejected = expect(result).rejects.toMatchObject({ code: 'gateway/cancelled' })
    try {
      await reading.promise
      control.abort()
      expect(observer.records[1]?.outcomes).toEqual([])
    } finally {
      release.resolve({ done: true, value: undefined })
      cleanup.resolve(undefined)
    }
    await rejected
    expect(observer.records[1]?.outcomes).toEqual(['cancelled'])
  })

  it('classifies pre-consumption cancellation without changing the carrier failure', async () => {
    const { ctx, observer } = await setup()
    const control = new AbortController()
    const stream = await ctx.typertGateway.stream({ ...request, peer: ownerPeer(ctx), signal: control.signal })
    control.abort()
    await expect(collect(stream)).rejects.toMatchObject({ code: 'gateway/cancelled' })
    expect(observer.records.map(record => record.outcomes)).toEqual([['success'], ['cancelled']])
  })
})
