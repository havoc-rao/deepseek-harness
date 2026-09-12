import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '@deepseek-ai/dsh-client-ui-sidebar-right'
import { PANEL_SETTINGS_NAMESPACE } from '../src/panel-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-sidebar-right host', () => {
  it('registers, validates, and disposes the durable panel namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = PANEL_SETTINGS_NAMESPACE
    // Unset is a missing field, never an explicit null (the fork's null
    // default would be no default at all).
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { rightbarExpanded: true })
    expect(ctx.settings.get(ns)).toEqual({ rightbarExpanded: true })
    await ctx.settings.update(ns, { rightbarExpanded: false })
    expect(ctx.settings.get(ns)).toEqual({ rightbarExpanded: false })
    await expect(ctx.settings.update(ns, { rightbarExpanded: 'yes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
