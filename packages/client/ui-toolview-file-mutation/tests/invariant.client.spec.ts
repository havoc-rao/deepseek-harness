/** The plugin's node half: an empty host body and an explained empty invariant
 *  companion (the browser half's registration is pinned by
 *  file-mutation-row.client.spec.tsx). */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ToolviewInvariant from '../src/invariant.ts'
import { apply } from '../src/index.ts'

describe('invariant companion', () => {
  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(ToolviewInvariant).await()).resolves.toBeDefined()
  })
})

describe('node half', () => {
  it('apply is a no-op host placeholder', () => {
    // The host body exists only so the plugin appears in the host cordis.yml;
    // every surface this plugin ships lives in the browser half.
    apply()
    expect(typeof apply).toBe('function')
  })
})
