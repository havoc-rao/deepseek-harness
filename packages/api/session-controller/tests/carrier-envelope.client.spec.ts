/** Source-plane Gateway named arguments reach the actual browser RPC timing selector. */
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { apply, inject } from '@deepseek-ai/dsh-api-gateway/client'
import { createWebConnectionRpc } from '../../../client/connection/src/client/rpc.ts'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionCreationObservationReport } from '../src/types.ts'
import { ClientSessions } from '../src/client/sessions/service.ts'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'

function descriptor(method: string, parameter?: string, resultDecoder = false): InvocationDescriptor {
  return {
    id: `@fixture/session#session/${method}`, service: 'sessionController', namespace: 'session', method,
    invocation: { kind: 'direct' },
    parameters: parameter === undefined ? [] : [{ name: parameter, wire: parameter, source: 'json', codec: { mode: 'strict', typeSymbol: '@fixture#Input', create: () => z.unknown() } }],
    result: { mode: 'strict', typeSymbol: '@fixture#Result', create: () => z.unknown(),
      ...(resultDecoder ? { decode: (value: unknown) => z.unknown().parse(value) } : {}),
    },
  }
}

it.each([false, true])('times only the matching token through Gateway and carrier (result decoder: %s)', async (resultDecoder) => {
  const ctx = new Context()
  const token = 'opaque-carrier-token'
  const requests: { method: string; payload: unknown }[] = []
  let report: SessionCreationObservationReport | undefined
  const rpc = createWebConnectionRpc((_url, init) => {
    if (typeof init.body !== 'string') throw new Error('Expected real browser JSON request')
    const request = JSON.parse(init.body) as {
      rpcId: string
      method: string
      payload: { args: { report?: SessionCreationObservationReport } }
    }
    requests.push({ method: request.method, payload: request.payload })
    if (request.method === 'session/finishCreationObservation') report = request.payload.args.report
    const value = request.method === 'session/beginCreationObservationV2' ? { token, version: 2 }
      : request.method === 'session/create' ? { sessionId: 'fixture-created' } : undefined
    return Promise.resolve(new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId,
      result: { ok: true, ...(value === undefined ? {} : { value }) },
    }), { headers: { 'content-type': 'application/json' } }))
  }, () => (async function *() { /* No history is opened by this test. */ })())
  const registrations: NonNullable<Parameters<NonNullable<typeof rpc.observeCalls>>[0]>[] = []
  const observe = rpc.observeCalls!.bind(rpc)
  const stopped = vi.fn()
  vi.spyOn(rpc, 'observeCalls').mockImplementation((selector) => {
    registrations.push(selector)
    const stop = observe(selector)
    return () => { stopped(); stop() }
  })
  try {
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', { rpc, registerGenerationSource: () => () => {}, start: () => ({ stop: () => {} }) } as never)
    await ctx.plugin({ apply, inject })
    await ctx.remote.$mount({ package: '@fixture/session', descriptors: [
      descriptor('beginCreationObservationV2'), descriptor('beginCreationObservation'),
      descriptor('create', 'request', resultDecoder), descriptor('finishCreationObservation', 'report'),
    ] })
    const sessions = new ClientSessions(ctx, ctx.remote)
    const observation = (await sessions.observeCreation())!
    await observation.create()
    const emitted = requests.find(request => request.method === 'session/create')?.payload
    expect(emitted).toEqual({ args: { request: { observationToken: token } } })
    // The former selector's top-level lookup misses the real Gateway envelope.
    expect(typeof emitted === 'object' && emitted !== null && 'request' in emitted).toBe(false)
    const selector = registrations[0]!
    expect(selector('/api', 'session/create', { args: { request: { observationToken: 'foreign' } } })).toBeUndefined()
    expect(selector('/api', 'session/list', emitted)).toBeUndefined()
    expect(selector('/other', 'session/create', emitted)).toBeUndefined()
    await sessions.create()
    await observation.end('success')
    expect(stopped).toHaveBeenCalledOnce()
    if (report === undefined || !('timeline' in report)) throw new Error('Expected timeline report')
    const carrierPhases = ['client.requestEncode', 'client.fetchHeaders', 'client.responseBodyRead',
      'client.responseEnvelopeParse', 'client.responseDecode', ...(resultDecoder ? ['client.resultCodecDecode'] : [])]
    expect(report.timeline.filter(item => carrierPhases.includes(item.phase)).map(item => item.phase)).toEqual(carrierPhases)
    const inclusive = report.timeline.find(item => item.phase === 'client.responseDecode')!
    for (const name of ['client.responseBodyRead', 'client.responseEnvelopeParse']) {
      const stage = report.timeline.find(item => item.phase === name)!
      expect(stage.startOffsetMs).toBeGreaterThanOrEqual(inclusive.startOffsetMs)
      expect(stage.endOffsetMs).toBeLessThanOrEqual(inclusive.endOffsetMs)
      expect(stage.outcome).toBe('success')
    }
    const resultCodec = report.timeline.find(item => item.phase === 'client.resultCodecDecode')
    if (resultDecoder) {
      expect(resultCodec?.startOffsetMs).toBeGreaterThanOrEqual(inclusive.endOffsetMs)
      expect(resultCodec?.outcome).toBe('success')
    } else expect(resultCodec).toBeUndefined()
    expect(report.timeline.some(item => item.phase === 'client.responseFormData' || item.phase === 'client.responseBinaryRead')).toBe(false)
    expect(requests.filter(request => request.method === 'session/create')).toHaveLength(2)
  } finally {
    await ctx.fiber.dispose()
    vi.restoreAllMocks()
  }
})
