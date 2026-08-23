/** The package's node half: an empty host body, the roster-adoption browser
 *  apply, and an explained empty invariant companion. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as KitInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'
import { apply as clientApply } from '../src/client/index.ts'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(KitInvariant).await()).resolves.toBeDefined()
  })
})

describe('apply seams', () => {
  it('the node half is an empty host body', () => {
    // The host body exists only so the package appears in the host cordis.yml;
    // every value this package ships lives in the browser half.
    nodeApply()
    expect(typeof nodeApply).toBe('function')
  })

  it('the browser half is the roster adoption seam', () => {
    // The kernel adopts the row as a plugin entry; the library needs no wiring.
    clientApply({} as never)
    expect(typeof clientApply).toBe('function')
  })
})
