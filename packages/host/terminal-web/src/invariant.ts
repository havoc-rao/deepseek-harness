/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-terminal-web`.
 * @module @deepseek-ai/dsh-host-terminal-web/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-terminal-web'

/** Cordis companion plugin name. */
export const name = 'host-terminal-web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the WebSocket upgrade route and its socket set are
 * owned by the plugin's `ctx.effect`, whose dispose callback terminates every
 * live client and closes the `WebSocketServer`. The effect registration
 * symmetry is covered by the upgrade-fence tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
