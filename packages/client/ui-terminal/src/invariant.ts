/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-terminal`.
 * @module @deepseek-ai/dsh-client-ui-terminal/invariant
 */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-terminal'

/** The invariant plugin name. */
export const name = 'client-ui-terminal-invariant'

/** Required services: the invariants registry. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

/** Registers the package invariant entry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
