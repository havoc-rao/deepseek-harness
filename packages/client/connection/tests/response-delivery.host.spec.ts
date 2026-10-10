/** Selected response framing and Node delivery events preserve the existing bridge flow. */
import { Context } from '@deepseek-ai/cordis'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { expect, it, vi } from 'vitest'
import { HostConnectionService } from '../src/rpc-host.ts'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { bridge } from '../src/http-bridge.ts'
import type { HostResponseObservation } from '../src/rpc.ts'

it.each(['success', 'close', 'error', 'unselected'] as const)('observes selected response delivery on %s', async (mode) => {
  const ctx = new Context()
  try {
    await ctx.plugin((owner) => { new HostConnectionService(owner, [], {} as BrowserAuth) })
    const connection = ctx.get('connection') as HostConnectionService
    const observation = vi.fn<HostResponseObservation>()
    const selector = vi.fn((channel: string, endpoint: string, payload: unknown, peer: object) => {
      expect(channel).toBe('/api')
      expect(endpoint).toBe('session/create')
      expect(peer).toBe(connection.operator)
      expect(payload).toEqual({ args: { request: { observationToken: 'test-only-token' } } })
      return mode === 'unselected' ? undefined : observation
    })
    const stop = connection.rpc.observeResponses!(selector)
    connection.rpc.intercept('/api', () => true, () => Promise.resolve({ ok: true, value: { privateResult: 'not recorded' } }))
    const handler = connection.createSharedFetchHandler('/api')
    const request = Readable.from([Buffer.from(JSON.stringify({
      type: 'client-request', rpcId: 'test-correlation', method: 'session/create',
      payload: { args: { request: { observationToken: 'test-only-token' } } },
    }))]) as IncomingMessage
    Object.assign(request, { url: '/api/session/create', method: 'POST', headers: { 'content-type': 'application/json' } })
    const response = Object.assign(new EventEmitter(), {
      destroyed: false, writableEnded: false,
      writeHead() { return this },
      write() {
        if (mode === 'error') throw new Error('private socket failure')
        if (mode === 'close') { response.destroyed = true; response.emit('close') }
        return true
      },
      end() { response.writableEnded = true; response.emit('finish'); return this },
    })
    if (mode === 'error') await expect(bridge(request, response, handler)).rejects.toThrow('private socket failure')
    else await bridge(request, response, handler)
    expect(selector).toHaveBeenCalledOnce()
    if (mode === 'unselected') expect(observation).not.toHaveBeenCalled()
    else {
      expect(observation.mock.calls[0]?.[0]).toBe('host.responseFrame')
      expect(observation.mock.calls.find(([phase]) => phase === 'host.responseWrite')?.[3])
        .toBe(mode === 'close' ? 'cancelled' : mode === 'error' ? 'error' : 'success')
      expect(observation.mock.calls.find(([phase]) => phase === 'host.responseFinish')?.[3])
        .toBe(mode === 'error' ? undefined : mode === 'close' ? 'cancelled' : 'success')
      for (const [, start, end] of observation.mock.calls) expect(end).toBeGreaterThanOrEqual(start)
      expect(JSON.stringify(observation.mock.calls)).not.toContain('private')
      expect(JSON.stringify(observation.mock.calls)).not.toContain('test-only-token')
    }
    expect(response.listenerCount('finish')).toBe(0)
    await stop()
    await handler.fetch(new Request('http://fixture/api/session/create', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request',
        rpcId: 'after-release', method: 'session/create', payload: {},
      }),
    }))
    expect(selector).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})
