/**
 * Route paths and wire payloads shared verbatim by the host routes and the
 * browser package (`@deepseek-ai/dsh-client-ui-open-in-app`), published as
 * the `./shared` subpath. Browser-safe: constants and types only.
 */

/** GET route serving the probed application ids. */
export const OPEN_IN_APP_APPS_ROUTE = '/open-in-app/apps'

/** GET prefix serving one PNG bundle icon per application id. */
export const OPEN_IN_APP_ICON_PREFIX = '/open-in-app/icon'

/** POST route launching one application on one workspace directory. */
export const OPEN_IN_APP_OPEN_ROUTE = '/open-in-app/open'

/** Wire description of a workspace target claimed by a host-side provider. */
export interface OpenInAppTargetPayload {
  /** Id of the claiming provider. */
  readonly provider: string
  /** Human-readable source label (for example `root@host:/srv/app`). */
  readonly label: string
}

/**
 * Apps-route response: the catalog ids to offer, in menu order, and the
 * claimed workspace target. `target: null` means the built-in local target;
 * `apps` then holds the locally probed catalog.
 */
export interface OpenInAppAppsPayload {
  readonly apps: readonly string[]
  readonly target: OpenInAppTargetPayload | null
}

/** Open-route request body. */
export interface OpenInAppOpenPayload {
  readonly app: string
  readonly path: string
  /** Session that owns `path`; a provider may scope its claim by it. */
  readonly sessionId?: string
}
