/** Browser availability/choice state and the launch carrier for the split button. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_OPEN_ROUTE,
  type OpenInAppAppsPayload, type OpenInAppOpenPayload, type OpenInAppTargetPayload,
} from '@deepseek-ai/dsh-host-open-in-app/shared'

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** One workspace path's resolved availability: the apps to offer and their claimed target. */
export interface OpenInAppAvailability {
  /** Catalog app ids for this path, in host menu order (empty when the read failed). */
  readonly apps: readonly string[]
  /** The provider-claimed target, or null for the built-in local target. */
  readonly target: OpenInAppTargetPayload | null
}

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/** Read one claimed target off the wire; a malformed value reads as the local target. */
function targetOf(value: unknown): OpenInAppTargetPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const { provider, label } = value as { provider?: unknown; label?: unknown }
  return typeof provider === 'string' && typeof label === 'string' ? { provider, label } : null
}

/**
 * Owns the per-path availability reads, the persisted last choice, and the
 * launch POST. Availability publishes through a uSES-safe source keyed by
 * workspace path, so a Session header shows its own path's target while
 * another Session's header may hold a different one.
 */
export class OpenInAppController {
  /** Resolved availability per workspace path; a missing key means "not read yet". */
  readonly availability: SnapshotStore<ReadonlyMap<string, OpenInAppAvailability>> =
    createSnapshotStore<ReadonlyMap<string, OpenInAppAvailability>>(new Map())
  /** Last chosen app id, or empty before the first choice, shared across sessions and browser restarts. */
  readonly choice: SnapshotStore<string> = createSnapshotStore<string>('', {
    persist: { name: 'dsh.open-in-app.choice' },
  })

  private readonly reads = new Map<string, Promise<void>>()

  /**
   * @param fetcher - HTTP carrier for the apps read and the launch POST.
   */
  constructor(private readonly fetcher: Fetch = (input, init) => fetch(input, init)) {}

  /**
   * Read availability for one workspace path; concurrent calls for the same
   * path share one read, and each path is read once per page life. The session
   * id travels with the request but does not key the cache: one workspace path
   * is one target. A failed read publishes an empty list, which renders no
   * button at all.
   * @param path - the session's absolute workspace directory.
   * @param sessionId - owning session, when the caller knows it.
   * @returns after this path's availability is published.
   */
  load(path: string, sessionId?: string): Promise<void> {
    let read = this.reads.get(path)
    if (read === undefined) {
      read = this.read(path, sessionId)
      this.reads.set(path, read)
    }
    return read
  }
  /**
   * Remember one picked app id.
   * @param appId - catalog id from the availability list.
   */
  choose(appId: string): void {
    this.choice.set(appId)
  }

  /**
   * Launch one installed app on a workspace directory.
   * @param appId - catalog id from the availability list.
   * @param path - the session's absolute workspace directory.
   * @param sessionId - owning session, when the caller knows it.
   * @returns after the host acknowledged the launch; rejects on any failure.
   */
  async launch(appId: string, path: string, sessionId?: string): Promise<void> {
    const body: OpenInAppOpenPayload = sessionId === undefined || sessionId === ''
      ? { app: appId, path }
      : { app: appId, path, sessionId }
    const response = await this.fetcher(new URL(OPEN_IN_APP_OPEN_ROUTE, hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`open failed: HTTP ${String(response.status)}`)
  }

  private async read(path: string, sessionId: string | undefined): Promise<void> {
    let availability: OpenInAppAvailability = { apps: [], target: null }
    try {
      const url = new URL(OPEN_IN_APP_APPS_ROUTE, hostBase())
      url.searchParams.set('path', path)
      if (sessionId !== undefined && sessionId !== '') url.searchParams.set('sessionId', sessionId)
      const response = await this.fetcher(url, { headers: { accept: 'application/json' } })
      if (response.ok) {
        const payload = await response.json() as OpenInAppAppsPayload
        if (Array.isArray(payload.apps)) {
          availability = {
            apps: payload.apps.filter(id => typeof id === 'string'),
            target: targetOf(payload.target),
          }
        }
      }
    } catch {
      // Swallows network failures: an unreachable host reads as no apps, and
      // the header simply shows no button rather than a broken one.
    }
    this.availability.set(new Map(this.availability.getSnapshot()).set(path, availability))
  }
}
