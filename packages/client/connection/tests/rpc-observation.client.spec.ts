/** Request-local carrier stage observations preserve payloads, failures, and cancellation. */
import { describe, expect, it, vi } from 'vitest'
import { createWebConnectionRpc } from '../src/client/rpc.ts'
import type { ConnectionRpcObservation } from '../src/rpc.ts'

describe('selected RPC carrier observations', () => {
  it('observes only selected calls and releases selectors without changing headers or payload', async () => {
    const send = vi.fn(async (_route: string | URL, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('Expected JSON request')
      const request = JSON.parse(init.body) as { rpcId: string; payload: object }
      return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: request.payload } })
    })
    const rpc = createWebConnectionRpc(send)
    const observation = vi.fn<ConnectionRpcObservation>()
    const release = rpc.observeCalls!((channel, endpoint, payload) => channel === '/api'
      && endpoint === 'session/create' && payload === selected ? observation : undefined)
    const selected = { request: { observationToken: 'private-token' } }
    await expect(rpc.call('/api', 'session/create', selected)).resolves.toEqual({ ok: true, value: selected })
    expect(observation.mock.calls.map(call => call[0])).toEqual([
      'client.requestEncode', 'client.fetchHeaders', 'client.responseBodyRead',
      'client.responseEnvelopeParse', 'client.responseDecode',
    ])
    for (const [, start, end, outcome] of observation.mock.calls) {
      expect(end).toBeGreaterThanOrEqual(start)
      expect(outcome).toBe('success')
    }
    expect(send.mock.calls[0]?.[1].headers).toEqual({ 'content-type': 'application/json' })
    await rpc.call('/api', 'session/list', {})
    release()
    await rpc.call('/api', 'session/create', selected)
    expect(observation).toHaveBeenCalledTimes(5)
  })

  it('reports decode errors and ignores failing diagnostic callbacks', async () => {
    const rpc = createWebConnectionRpc(async () => Response.json({ invalid: true }))
    const observation = vi.fn<ConnectionRpcObservation>(() => { throw new Error('diagnostic') })
    rpc.observeCalls!(() => observation)
    await expect(rpc.call('/api', 'session/create', {})).rejects.toThrow('server-response envelope')
    expect(observation.mock.calls.at(-1)?.[0]).toBe('client.responseDecode')
    expect(observation.mock.calls.at(-1)?.[3]).toBe('error')
  })

  it.each(['', '{'])('separates selected body reading from JSON parsing failure for %j', async (body) => {
    const responses: Response[] = []
    const rpc = createWebConnectionRpc(async () => {
      const response = new Response(body, { headers: { 'content-type': 'application/json' } })
      responses.push(response)
      return response
    })
    const observation = vi.fn<ConnectionRpcObservation>()
    rpc.observeCalls!(() => observation)
    const normal: unknown = await new Response(body).json().catch((error: unknown) => error)
    const selected = await rpc.call('/api', 'session/create', {}).catch((error: unknown) => error)
    expect(selected).toBeInstanceOf(SyntaxError)
    expect(selected instanceof Error ? selected.message : '').toBe(normal instanceof Error ? normal.message : '')
    expect(responses[0]?.bodyUsed).toBe(true)
    expect(observation.mock.calls.map(([phase, , , outcome]) => [phase, outcome])).toEqual([
      ['client.requestEncode', 'success'], ['client.fetchHeaders', 'success'],
      ['client.responseBodyRead', 'success'], ['client.responseEnvelopeParse', 'error'], ['client.responseDecode', 'error'],
    ])
  })

  it('leaves unselected JSON responses on response.json and consumes selected bodies only once', async () => {
    const responses: Response[] = []
    const spies: { json: ReturnType<typeof vi.spyOn>; text: ReturnType<typeof vi.spyOn> }[] = []
    const rpc = createWebConnectionRpc(async (_url, init) => {
      if (typeof init.body !== 'string') throw new Error('Expected JSON request')
      const request = JSON.parse(init.body) as { rpcId: string }
      const response = Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: 1 } })
      responses.push(response)
      spies.push({ json: vi.spyOn(response, 'json'), text: vi.spyOn(response, 'text') })
      return response
    })
    await rpc.call('/api', 'session/list', {})
    expect(spies[0]?.json).toHaveBeenCalledOnce()
    expect(spies[0]?.text).not.toHaveBeenCalled()
    rpc.observeCalls!(() => vi.fn<ConnectionRpcObservation>())
    await rpc.call('/api', 'session/create', {})
    expect(spies[1]?.text).toHaveBeenCalledOnce()
    expect(spies[1]?.json).not.toHaveBeenCalled()
  })

  it('reports body-read rejection as cancelled without parsing and preserves rejection identity', async () => {
    const abort = new AbortController()
    const error = new Error('body interrupted')
    const response = Response.json({})
    vi.spyOn(response, 'text').mockImplementation(async () => { abort.abort(); throw error })
    const rpc = createWebConnectionRpc(async () => response)
    const observation = vi.fn<ConnectionRpcObservation>()
    rpc.observeCalls!(() => observation)
    await expect(rpc.call('/api', 'session/create', {}, abort.signal)).rejects.toBe(error)
    expect(observation.mock.calls.slice(-2).map(([phase, , , outcome]) => [phase, outcome])).toEqual([
      ['client.responseBodyRead', 'cancelled'], ['client.responseDecode', 'cancelled'],
    ])
    expect(observation.mock.calls.some(([phase]) => phase === 'client.responseEnvelopeParse')).toBe(false)
  })

  it('measures synchronous consumer codecs without replacing the value or thrown error', () => {
    const rpc = createWebConnectionRpc()
    const observation = vi.fn<ConnectionRpcObservation>()
    const release = rpc.observeCalls!(() => observation)
    const value = {}
    expect(rpc.runObservedResult!('/api', 'session/create', {}, () => value)).toBe(value)
    const error = new Error('codec rejected')
    expect(() => rpc.runObservedResult!('/api', 'session/create', {}, () => { throw error })).toThrow(error)
    expect(observation.mock.calls.map(([phase, , , outcome]) => [phase, outcome])).toEqual([
      ['client.resultCodecDecode', 'success'], ['client.resultCodecDecode', 'error'],
    ])
    release()
    rpc.runObservedResult!('/api', 'session/create', {}, () => 1)
    expect(observation).toHaveBeenCalledTimes(2)
  })

  it('reports aborted send as cancelled and preserves the transport rejection', async () => {
    const abort = new AbortController()
    const error = new Error('private transport error')
    const rpc = createWebConnectionRpc(async () => { abort.abort(); throw error })
    const observation = vi.fn<ConnectionRpcObservation>()
    rpc.observeCalls!(() => observation)
    await expect(rpc.call('/api', 'session/create', {}, abort.signal)).rejects.toBe(error)
    expect(observation.mock.calls.at(-1)?.[0]).toBe('client.fetchHeaders')
    expect(observation.mock.calls.at(-1)?.[3]).toBe('cancelled')
  })
})
