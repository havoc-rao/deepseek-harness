/**
 * The per-conversation request header the OpenCode gateway requires.
 *
 * OpenCode's Console Go and Zen gateways route one conversation to one backend
 * by the `x-opencode-session` request header and answer HTTP 400
 * `MissingSessionID` when it is absent. The adapter attaches the harness session
 * id to every request those gateways would otherwise refuse: it is unique per
 * conversation and stable across that conversation's turns, resumes, and
 * retries, which is the affinity the gateway reads it for. A request naming no
 * session id sends a fresh one so it still routes.
 *
 * @module dsh-llm-pi-ai/opencode-session
 */

import { randomUUID } from 'node:crypto'

/** Request header the OpenCode gateway routes on. */
const OPENCODE_SESSION_HEADER = 'x-opencode-session'

/** Installed pi-ai provider ids that serve the OpenCode gateway. */
const OPENCODE_PROVIDERS: readonly string[] = ['opencode', 'opencode-go']

/** Gateway host, matched together with its subdomains. */
const OPENCODE_GATEWAY_HOST = 'opencode.ai'

/**
 * Whether one route reaches the OpenCode gateway, by catalog provider id or by
 * the endpoint it actually resolves to. The provider id catches the catalog
 * routes even when a profile repoints them through a proxy; the endpoint host
 * catches a route the catalog does not describe.
 * @param provider - the route key the request selects.
 * @param endpoint - the resolved model endpoint.
 * @returns true when the request reaches the OpenCode gateway.
 */
function reachesOpencodeGateway(provider: string, endpoint: string | undefined): boolean {
  if (OPENCODE_PROVIDERS.includes(provider)) return true
  if (endpoint === undefined) return false
  let host: string
  try {
    host = new URL(endpoint).hostname.toLowerCase()
  } catch {
    // pi-ai refuses an endpoint it cannot parse before any request leaves, so
    // an unparseable one cannot reach the gateway and gateway matching is moot.
    return false
  }
  return host === OPENCODE_GATEWAY_HOST || host.endsWith(`.${OPENCODE_GATEWAY_HOST}`)
}

/**
 * The OpenCode session header for one request, or nothing for any other route.
 * A deployment-configured header of the same name wins, because profile headers
 * are deployment-owned.
 * @param provider - the route key the request selects.
 * @param endpoint - the resolved model endpoint.
 * @param sessionId - the harness session id when the request names one.
 * @param deploymentHeaders - the route's configured profile headers.
 * @returns the header to merge into the request, empty when the route is not the OpenCode gateway's.
 */
export function opencodeSessionHeaders(
  provider: string,
  endpoint: string | undefined,
  sessionId: string | undefined,
  deploymentHeaders?: Readonly<Record<string, string>>,
): Record<string, string> {
  if (!reachesOpencodeGateway(provider, endpoint)) return {}
  const configured = Object.keys(deploymentHeaders ?? {})
    .some(name => name.toLowerCase() === OPENCODE_SESSION_HEADER)
  if (configured) return {}
  return { [OPENCODE_SESSION_HEADER]: sessionId ?? randomUUID() }
}
