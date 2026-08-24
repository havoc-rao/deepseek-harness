/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-workspace-logo`.
 * @module @deepseek-ai/dsh-client-workspace-logo/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-workspace-logo'

/** Cordis companion plugin name. */
export const name = 'client-workspace-logo-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin's three row-hole occupants install and
 * uninstall with the slot declarations, which the HMR-safety spec proves;
 * every rendered fact (the logo data URL) arrives from the Host view.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
