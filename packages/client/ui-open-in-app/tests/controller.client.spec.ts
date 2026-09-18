/** Controller wire behavior: per-path availability, target parsing, and launch errors. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenInAppController } from '../src/client/controller.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

/** The one entry a controller holds for a path. */
function availabilityOf(controller: OpenInAppController, key: string): unknown {
  return controller.availability.getSnapshot().get(key)
}

describe('OpenInAppController availability', () => {
  it('starts without a platform-specific choice', () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [], target: null }))
    expect(controller.choice.getSnapshot()).toBe('')
  })

  it('shares one read across concurrent loads of the same path and session', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ apps: ['finder'], target: null }))
    const controller = new OpenInAppController(fetcher)
    await Promise.all([controller.load('/w/dir', 's1'), controller.load('/w/dir', 's1')])
    await controller.load('/w/dir', 's1')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(availabilityOf(controller, '/w/dir')).toEqual({ apps: ['finder'], target: null })
  })

  it('reads again when the workspace path changes', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).searchParams.get('path')
      return jsonResponse({ apps: [path === '/w/one' ? 'finder' : 'cursor'], target: null })
    })
    const controller = new OpenInAppController(fetcher)
    await controller.load('/w/one')
    await controller.load('/w/two')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(availabilityOf(controller, '/w/one')).toEqual({ apps: ['finder'], target: null })
    expect(availabilityOf(controller, '/w/two')).toEqual({ apps: ['cursor'], target: null })
  })

  it('publishes the claimed target from the host answer', async () => {
    const controller = new OpenInAppController(async () => jsonResponse({
      apps: ['cursor', 7],
      target: { provider: 'dsh-remote', label: 'root@host:/srv/app' },
    }))
    await controller.load('/w/dir', 's1')
    expect(availabilityOf(controller, '/w/dir')).toEqual({
      apps: ['cursor'],
      target: { provider: 'dsh-remote', label: 'root@host:/srv/app' },
    })
  })

  it('reads a malformed target as the built-in local target', async () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: ['finder'], target: 'remote' }))
    await controller.load('/w/dir')
    expect(availabilityOf(controller, '/w/dir')).toEqual({ apps: ['finder'], target: null })
  })

  it('publishes an empty list for a non-OK answer and for a non-array payload', async () => {
    const failing = new OpenInAppController(async () => jsonResponse({}, 500))
    await failing.load('/w/dir')
    expect(availabilityOf(failing, '/w/dir')).toEqual({ apps: [], target: null })

    const malformed = new OpenInAppController(async () => jsonResponse({ apps: 'nope' }))
    await malformed.load('/w/dir')
    expect(availabilityOf(malformed, '/w/dir')).toEqual({ apps: [], target: null })
  })

  it('resolves routes against the page origin when the page has one', async () => {
    vi.stubGlobal('location', { origin: 'http://dsh.example:8080' })
    const fetcher = vi.fn(async (input: string | URL) => { void input; return jsonResponse({ apps: [], target: null }) })
    const controller = new OpenInAppController(fetcher)
    await controller.load('/w/dir', 's1')
    const url = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(url.origin + url.pathname).toBe('http://dsh.example:8080/open-in-app/apps')
    expect(url.searchParams.get('path')).toBe('/w/dir')
    expect(url.searchParams.get('sessionId')).toBe('s1')
  })

  it('falls back to the internal host base under a null origin', async () => {
    vi.stubGlobal('location', { origin: 'null' })
    const fetcher = vi.fn(async (input: string | URL) => { void input; return jsonResponse({ apps: [], target: null }) })
    const controller = new OpenInAppController(fetcher)
    await controller.load('/w/dir')
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://dsh.internal/open-in-app/apps?path=%2Fw%2Fdir')
  })
})

describe('OpenInAppController launching', () => {
  it('restores the chosen app from the open-in-app storage key', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [], target: null }))
    controller.choose('cursor')
    expect(controller.choice.getSnapshot()).toBe('cursor')
    expect(values.get('dsh.open-in-app.choice')).toBe('"cursor"')
    const reloaded = new OpenInAppController(async () => jsonResponse({ apps: [], target: null }))
    expect(reloaded.choice.getSnapshot()).toBe('cursor')
  })

  it('posts the launch body, with and without a session id, and surfaces HTTP failures', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => { void input; void init; return jsonResponse({ ok: true }) })
    const controller = new OpenInAppController(fetcher)
    await controller.launch('cursor', '/w/dir')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'cursor', path: '/w/dir' }),
    })
    await controller.launch('cursor', '/w/dir', 's1')
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ app: 'cursor', path: '/w/dir', sessionId: 's1' }),
    })

    const failing = new OpenInAppController(async () => jsonResponse({}, 404))
    await expect(failing.launch('cursor', '/w/dir')).rejects.toThrow('open failed: HTTP 404')
  })
})
