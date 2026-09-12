import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '@deepseek-ai/dsh-client-ui-layout'
import { LAYOUT_SETTINGS_NAMESPACE, RIGHTBAR_PERSIST_MAX } from '../src/layout-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-layout host', () => {
  it('registers, validates, and disposes the durable layout namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = LAYOUT_SETTINGS_NAMESPACE
    // Unset is a missing field, never an explicit null (the fork's null
    // default would be no default at all).
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { rightbar: 420 })
    expect(ctx.settings.get(ns)).toEqual({ rightbar: 420 })
    await expect(ctx.settings.update(ns, { rightbar: 299 })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { rightbar: RIGHTBAR_PERSIST_MAX + 1 })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { rightbar: 420.5 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
