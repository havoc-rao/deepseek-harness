// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '../src/index.ts'
import { apply as clientApply, inject } from '../src/client/index.ts'
import * as PaperInvariant from '../src/invariant.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as themeApply, inject as themeInject } from '@deepseek-ai/dsh-client-ui-theme/client'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PaperInvariant).await()).resolves.toBeDefined()
  })

  it('node-half waits for optional Host services', () => {
    nodeApply(new Context())
    expect(true).toBe(true)
  })

  it('client apply contributes the paper feature over the theme service', async () => {
    expect(inject).toEqual(['slots', 'locale', 'theme'])
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: themeInject, apply: themeApply }).await()
    await ctx.plugin({ inject, apply: clientApply }).await()
    expect(ctx.get('theme')).toBeDefined()
  })
})
