/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-tool-kit`.
 * @module @deepseek-ai/dsh-client-ui-tool-kit/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-tool-kit'

/** Cordis companion plugin name. */
export const name = 'client-ui-tool-kit-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: pure props-in row chrome and models over frozen
 * Tool call slices with no events, services, or mutable cross-plugin state;
 * rendering contracts are asserted directly by this package's component specs.
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
