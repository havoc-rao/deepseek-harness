import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// Relative source imports: this package's lib/ may not exist on a clean tree
// (test:source regressions resolve through tsconfig paths, which stop at the
// package boundary; the /invariant subpath has no src mapping).
import * as WorkspaceLogoInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WorkspaceLogoInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('../src/index.ts')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
