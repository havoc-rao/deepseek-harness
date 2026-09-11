/**
 * Wire protocol of the `/plugins/events` dev SSE channel — single source for
 * both halves of this package. Frames still cross a wire boundary: the
 * browser half validates them at its JSON parse point; sharing the type keeps
 * the two ends from drifting, not from parsing.
 */

import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/**
 * One SSE frame: the full graph on connect, or one rebuilt bundle notice.
 * The graph frame carries the host process's instance id — every (re)connect
 * re-sends it, and the browser half treats a changed instance as a host
 * restart whose stale tab must reload.
 */
export type PluginsEventFrame =
  | { type: 'graph'; graph: WebBootGraph; instance: string }
  | { type: 'rebuilt'; id: string; rev: string }

/** Browser wire-parse result: known frame, forward-compatible unknown type, or malformed payload. */
export type PluginsEventParseResult =
  | { kind: 'frame'; frame: PluginsEventFrame }
  | { kind: 'unknown' }
  | { kind: 'invalid' }

/**
 * Validate one JSON-decoded SSE payload before it can mutate module state.
 * @param value - Parsed JSON value from the EventSource message.
 * @returns the known frame, an unknown-type marker, or an invalid marker.
 */
export function parsePluginsEventFrame(value: unknown): PluginsEventParseResult {
  if (typeof value !== 'object' || value === null) return { kind: 'invalid' }
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'rebuilt':
      return typeof record.id === 'string' && typeof record.rev === 'string'
        ? { kind: 'frame', frame: { type: 'rebuilt', id: record.id, rev: record.rev } }
        : { kind: 'invalid' }
    case 'graph':
      return typeof record.graph === 'object' && record.graph !== null && typeof record.instance === 'string'
        ? { kind: 'frame', frame: { type: 'graph', graph: record.graph as WebBootGraph, instance: record.instance } }
        : { kind: 'invalid' }
    default:
      return typeof record.type === 'string' ? { kind: 'unknown' } : { kind: 'invalid' }
  }
}

/** System SSE endpoint pushing graph/rebuilt frames (wire protocol constant). */
export const EVENTS_ENDPOINT = '/plugins/events'
