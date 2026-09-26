/** Topology reproduction for the deferred RPC channel mount: a consumer
 * plugin registering a channel from its own apply, the way out-of-repo
 * plugins use connection.rpc.handle. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { HostConnectionHandle } from '../src/index.ts'
import { apply, inject } from '../src/index.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

/** Minimal webServer fake recording registrations (same shape as the node-half bench). */
function fakeServer(routes: WebRoute[]): WebServer {
  return {
    register(route: WebRoute) {
      if (routes.some(row => row.path === route.path)) throw new Error(`duplicate route ${route.path}`)
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
  } as unknown as WebServer
}

describe('deferred channel mount topology', () => {
  it('mounts a consumer-registered channel when webServer comes from another plugin', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    provideBrowserCredentials(ctx)
    // webServer as a sibling plugin (not a root provide), mirroring the Loader tree.
    await ctx.plugin({
      name: 'fake-webserver',
      apply(webCtx: Context) { webCtx.provide('webServer', fakeServer(routes)) },
    }).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    // A consumer plugin registering its channel at its own apply time.
    await ctx.plugin({
      name: 'consumer',
      inject: ['connection'],
      apply(consumerCtx: Context) {
        const connection = consumerCtx.get('connection') as HostConnectionHandle | undefined
        if (connection === undefined) throw new Error('connection missing')
        consumerCtx.effect(() => connection.rpc.handle('/consumer-rpc', async () => ({ ok: true, value: null })))
      },
    }).await()

    await new Promise(resolve => setTimeout(resolve, 300))
    await vi.waitFor(() => {
      expect(routes.find(route => route.path === '/consumer-rpc')).toBeDefined()
    })
    await ctx.fiber.dispose()
  })
})
