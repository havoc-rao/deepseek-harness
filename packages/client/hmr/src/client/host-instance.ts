/**
 * Host-restart detection for the browser half: pure decision on the SSE
 * reconnect handshake's instance ids. Kept DOM-free so it unit-tests under
 * plain node; the EventSource driver owns the window side effects.
 */

/** What the browser half should do with one graph frame's instance id. */
export type HostInstanceAction = 'record' | 'reload' | 'ignore'

/**
 * Decide how to treat a graph frame's host instance id.
 * The first connect after page boot establishes the baseline (`record`);
 * every later frame with a different instance means the host process
 * restarted while this tab lived (`reload` — the in-page loader graph is a
 * whole generation stale, and nothing short of a page reload can rebuild
 * fiber identities against the new host). A missing id is a legacy host with
 * no identity signal (`ignore`).
 * @param current - the instance id of the host this tab has been talking to, or `undefined` before the first connect.
 * @param next - the instance id carried by the arriving graph frame.
 * @returns the action to take.
 */
export function hostInstanceAction(current: string | undefined, next: string | undefined): HostInstanceAction {
  if (next === undefined) return 'ignore'
  if (current === undefined) return 'record'
  return next === current ? 'ignore' : 'reload'
}
