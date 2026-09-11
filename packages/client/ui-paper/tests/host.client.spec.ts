import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { THEME_SETTINGS_NAMESPACE, apply as themeApply } from '@deepseek-ai/dsh-client-ui-theme'
import { PAPER_SETTINGS_NAMESPACE } from '../src/paper-settings.ts'
import { apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** Collect the injection table the way an index render or boot payload does. */
function collect(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

/** The paper row — the theme host contributes the preference row alongside. */
function paperRow(ctx: Context): IndexInjection | undefined {
  return collect(ctx).find(row => row.kind === 'script' && row.text.includes('paperTokens'))
}

/** Narrow a script row to its body. */
function scriptText(row: IndexInjection | undefined): string {
  if (row?.kind !== 'script') throw new Error('expected a script row')
  return row.text
}

/** Bench the real pair: the theme host registers the preference schema, the
 * paper host registers its own section and reads both namespaces. */
async function bench(ctx: Context): Promise<{ dispose: () => Promise<void> }> {
  await ctx.plugin({ apply: themeApply }).await()
  const fiber = ctx.plugin({ apply })
  await fiber.await()
  return { dispose: () => fiber.dispose() }
}

describe('ui-paper host', () => {
  it('answers each collection with the durable tone until disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const { dispose } = await bench(ctx)
    expect(scriptText(paperRow(ctx))).toContain('const paperTokens = {}')
    await ctx.settings.update(PAPER_SETTINGS_NAMESPACE, { tone: 'cream' })
    const text = scriptText(paperRow(ctx))
    expect(text).toContain('rgb(253, 251, 246)')
    expect(text).toContain('rgb(27, 26, 24)')
    await dispose()
    // The paper contribution unwinds with its fiber.
    expect(paperRow(ctx)).toBeUndefined()
  })

  it('falls back to the default tone without a settings provider', async () => {
    const ctx = new Context()
    await bench(ctx)
    expect(scriptText(paperRow(ctx))).toContain('const paperTokens = {}')
  })

  it('falls back to the defaults while the namespaces hold no section', async () => {
    // A settings provider whose namespace read comes back empty (registration
    // still pending or a provider without schema defaults).
    const ctx = new Context()
    ctx.provide('settings', { register: () => () => {}, get: () => undefined } as never)
    await bench(ctx)
    const text = scriptText(paperRow(ctx))
    expect(text).toContain('const preference = "system"')
    expect(text).toContain('const paperTokens = {}')
  })

  it('uses the durable preference for the variant selection', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await bench(ctx)
    await ctx.settings.update(THEME_SETTINGS_NAMESPACE, { preference: 'dark' })
    await ctx.settings.update(PAPER_SETTINGS_NAMESPACE, { tone: 'cream' })
    expect(scriptText(paperRow(ctx))).toContain('const preference = "dark"')
  })
})
