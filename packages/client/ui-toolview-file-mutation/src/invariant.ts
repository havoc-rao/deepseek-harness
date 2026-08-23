/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-toolview-file-mutation`.
 * @module @deepseek-ai/dsh-client-ui-toolview-file-mutation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-toolview-file-mutation'

/** Cordis companion plugin name. */
export const name = 'client-ui-toolview-file-mutation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: keyed toolview registrations are effects owned and
 * observed by the slot registry; the row's rendering contracts are asserted
 * directly by this package's component specs.
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
