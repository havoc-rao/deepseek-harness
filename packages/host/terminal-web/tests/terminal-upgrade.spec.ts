/**
 * Upgrade-path coverage for the browser-trust fence: every socket to
 * /api/terminals must pass `isTrustedApiRequest` before the ws handshake runs.
 * Loopback is always trusted, a configured `trustedHosts` entry extends the
 * grant, and every other Host is refused with 403 before negotiation.
 */
import { once } from 'node:events'
import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { WebServer, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import { TERMINAL_UPGRADE_PATH, apply, inject } from '../src/index.ts'

/** Structural webServer fake recording the upgrade registry. */
function fakeHttpServer(upgrades: WebUpgradeRoute[]): Pick<WebServer, 'registerUpgrade'> {
  return {
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
  }
}

/** Bodyless GET carrying the given headers (enough for the trust fence). */
function fakeRequest(headers: Record<string, string>): IncomingMessage {
  const request = new PassThrough() as unknown as IncomingMessage
  Object.assign(request, { url: TERMINAL_UPGRADE_PATH, method: 'GET', headers })
  return request
}

async function mounted(config?: { trustedHosts?: string[] }): Promise<{
  upgrades: WebUpgradeRoute[]
  spawn: ReturnType<typeof vi.fn>
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const upgrades: WebUpgradeRoute[] = []
  ctx.provide('webServer', fakeHttpServer(upgrades) as WebServer)
  const spawn = vi.fn(async () => { throw new Error('unexpected spawn before an Open frame') })
  ctx.provide('subprocess', {
    spawnTerminal: spawn,
  } as unknown as SubprocessRuntime)
  const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: config?.trustedHosts ?? [] })
  await fiber.await()
  return { upgrades, spawn, dispose: () => fiber.dispose() }
}

/** Serve the registered upgrade handler on a loopback http server. */
async function serveUpgrade(upgrades: WebUpgradeRoute[]): Promise<{
  port: number
  close: () => Promise<void>
}> {
  const server = createServer()
  server.on('upgrade', (req, socket, head) => { void upgrades[0]!.handler(req, socket, head) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    port,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

describe('terminal-web upgrade fence', () => {
  it('registers one /api/terminals upgrade route and removes it with the fiber', async () => {
    const { upgrades, dispose } = await mounted()
    expect(upgrades.map(route => route.path)).toEqual([TERMINAL_UPGRADE_PATH])
    await dispose()
    expect(upgrades).toHaveLength(0)
  })

  it('rejects an untrusted Host upgrade with 403 before negotiation', async () => {
    const { upgrades, dispose } = await mounted()
    const socket = new PassThrough()
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    const ended = once(socket, 'end')
    await upgrades[0]!.handler(fakeRequest({
      host: 'harness.example', origin: 'http://harness.example', 'sec-fetch-site': 'same-origin',
    }), socket, Buffer.alloc(0))
    await ended
    expect(Buffer.concat(chunks).toString()).toContain('HTTP/1.1 403 Forbidden')
    await dispose()
  })

  it('passes a loopback upgrade through to the ws handshake', async () => {
    const { upgrades, spawn, dispose } = await mounted()
    const { port, close } = await serveUpgrade(upgrades)
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${TERMINAL_UPGRADE_PATH}`)
    await once(ws, 'open')
    ws.close()
    await once(ws, 'close')
    expect(spawn).not.toHaveBeenCalled()
    await close()
    await dispose()
  })

  it('passes a declared trustedHosts upgrade through to the ws handshake', async () => {
    const { upgrades, spawn, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    const { port, close } = await serveUpgrade(upgrades)
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${TERMINAL_UPGRADE_PATH}`, {
      headers: { Host: `harness.example:${String(port)}` },
    })
    await once(ws, 'open')
    ws.close()
    await once(ws, 'close')
    expect(spawn).not.toHaveBeenCalled()
    await close()
    await dispose()
  })

  it('rejects an untrusted Host upgrade over a real socket', async () => {
    const { upgrades, dispose } = await mounted()
    const { port, close } = await serveUpgrade(upgrades)
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${TERMINAL_UPGRADE_PATH}`, {
      headers: { Host: `attacker.example:${String(port)}` },
    })
    const error = await new Promise<Error>((resolve) => { ws.on('error', resolve) })
    expect(error.message).toContain('403')
    await close()
    await dispose()
  })
})
