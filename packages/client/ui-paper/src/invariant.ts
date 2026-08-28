/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-paper`.
 * @module @deepseek-ai/dsh-client-ui-paper/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-paper'

/** Cordis companion plugin name. */
export const name = 'client-ui-paper-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the theme service validates and publishes the durable
 * tone field, the layer-table contribution has its own disposer, and the
 * settings scope signals changes through `theme/change` synchronously.
 * Store/registry agreement is covered directly by this package's Host,
 * scope, and service behavior specs.
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
