// @vitest-environment jsdom
/**
 * The per-card action slot through the production renderer: a contributed
 * trigger renders on every preset card with that card's preset id and the
 * settings close seat, its text follows its own locale dictionary (the `t`
 * seat, exactly like any settings contribution), nothing renders without
 * contributors, a throwing contributor is contained to its own entry, and a
 * disposed contributor's fiber removes its trigger. The friendlier isolated
 * checks live next to the other component and apply specs; this suite proves
 * the assembled behavior over `SlotTestRuntime`.
 */
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { ComposedProps, PropsLocale, PropsRuntime, SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { IconSettingsOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply as presetApply, inject as presetInject } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'

usePinnedBrowserLanguages('zh-CN')

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Test-only dictionary of a contributed card action trigger. */
    'test.cardAction': 'configure'
  }
}

const ROSTER = {
  ok: true as const,
  value: {
    presets: [{ id: 'standard', isDefault: true }, { id: 'mine', name: 'Mine', isDefault: false }],
  },
}

// The shipped developer-tools preference the section's selection gate reads.
const SETTINGS_DESCRIBE = {
  ok: true as const,
  value: {
    writable: true,
    hasDocument: true,
    namespaces: [{
      ns: 'ui-settings',
      schema: { type: 'object', dict: { enabled: { type: 'boolean' } } },
      value: { enabled: true },
      autoGenerate: false,
      applies: 'live',
      secrets: [],
      revision: 0,
    }],
  },
}

type RootProps = ComposedProps<'root', never, 'settings.section', undefined, object>
/** The shell frame: renders the Agent presets section with one shared close. */
function makeFrame(onClose: () => void): SlotComponent<RootProps> {
  const RootFrame = ({ renderSlot }: RootProps): ReactNode => (
    <>{renderSlot('settings.section', { close: onClose })}</>
  )
  return RootFrame
}

const CONFIGURE_ZH = { configure: '配置' } as const
const CONFIGURE_EN = { configure: 'Configure' } as const

type ConfigureProps = PropsRuntime<'settings.agentPreset.card.action'> & PropsLocale<'test.cardAction'>
/** Presets whose declared toolchain needs a protocol configuration this trigger edits. */
const NEEDS_PROTOCOL_CONFIG = new Set(['mine'])
/**
 * A third-party trigger in the card's view-button pattern (native focusable
 * button, `aria-label` and `data-tip` from its own dictionary, settings
 * glyph), shown only on the cards that need the configuration it edits — a
 * card without it keeps the empty seat (returning null occupies nothing).
 */
function ConfigureButton({ presetId, close, t }: ConfigureProps): ReactNode {
  if (!NEEDS_PROTOCOL_CONFIG.has(presetId)) return null
  const label = `${t('configure')}: ${presetId}`
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={close}>
      <IconSettingsOutlineRegular size={14} />
    </button>
  )
}

/** A feature contribution with its own locale dictionary and dialog trigger. */
const GOOD_CHILD = {
  inject: ['slots', 'locale'],
  apply(ctx: Context): void {
    ctx.locale.register('test.cardAction', { zh: CONFIGURE_ZH, en: CONFIGURE_EN })
    ctx.slots.inject('settings.agentPreset.card.action', () => ctx.slots.register({
      name: 'settings.agentPreset.card.action',
      id: 'test-config',
      order: 0,
      locale: 'test.cardAction',
    }, ConfigureButton))
  },
}

/** A broken contribution: its render always throws. */
const CRASH_CHILD = {
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('settings.agentPreset.card.action', () => ctx.slots.register({
      name: 'settings.agentPreset.card.action',
      id: 'boom',
      order: 10,
    }, (): ReactNode => { throw new Error('card action exploded') }))
  },
}

let runtime: SlotTestRuntime | undefined
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  if (runtime !== undefined) {
    await runtime.dispose()
    runtime = undefined
  }
})

async function bench() {
  const r = await SlotTestRuntime.create()
  runtime = r
  const close = vi.fn()
  r.remote.provideNamespaces({
    settings: {
      describe: () => Promise.resolve(SETTINGS_DESCRIBE),
      update: () => Promise.resolve({ ok: true as const, value: {} }),
    },
    agentPresets: {
      list: () => Promise.resolve(ROSTER),
      read: (id: string) => Promise.resolve({ ok: true as const, value: { agentPreset: id, content: '# x\n[]\n' } }),
    },
  })
  const locale = new LocaleRuntime(r.ctx)
  r.ctx.provide('locale', locale)
  r.slots.installLocale(locale)
  await r.mount({ inject: [...settingsInject], apply: settingsApply })
  await vi.waitFor(() => { expect(r.ctx.configForms.developerTools.enabled.getSnapshot()).toBe(true) })
  await r.root.declare({ 'settings.section': { kind: 'list', scope: 'root' } }, makeFrame(close))
  await r.mount({ inject: [...presetInject], apply: presetApply })
  return { runtime: r, locale, close }
}

const viewButton = /查看配置/

it('renders unchanged cards when no contributor occupies the action seat', async () => {
  const { runtime: r } = await bench()
  const view = r.renderRoot()
  await waitFor(() => { expect(view.getAllByRole('button', { name: viewButton })).toHaveLength(2) })

  // One empty outlet anchor per card, nothing inside: no button, no text,
  // no placeholder box (the anchor is display:contents in production).
  const anchors = view.container.querySelectorAll('[data-slot="settings.agentPreset.card.action"]')
  expect(anchors).toHaveLength(2)
  for (const anchor of anchors) {
    expect(anchor.childElementCount).toBe(0)
    expect(anchor.textContent).toBe('')
  }
  expect(view.queryAllByRole('button', { name: /^配置:/ })).toHaveLength(0)
})

it('renders its trigger only on the cards that need the configuration, with close and locale text', async () => {
  const { runtime: r, locale, close } = await bench()
  await r.mount(GOOD_CHILD)
  const view = r.renderRoot()

  // The roster has 'standard' (no protocol configuration) and 'mine' (one):
  // the contribution decides per card itself, so only 'mine' shows a
  // trigger while 'standard' keeps the empty seat.
  await waitFor(() => { expect(view.getByRole('button', { name: '配置: mine' })).toBeTruthy() })
  const trigger = view.getByRole('button', { name: '配置: mine' })
  expect(view.queryByRole('button', { name: '配置: standard' })).toBeNull()
  // The trigger is the native focusable icon button of the card's view
  // button pattern, with the settings glyph and its own dictionary label.
  expect(trigger.tagName).toBe('BUTTON')
  expect(trigger.querySelector('svg')).not.toBeNull()
  // Clicking it reaches the Settings close seat.
  fireEvent.click(trigger)
  expect(close).toHaveBeenCalledOnce()
  // A locale switch re-labels the trigger without re-registering (the `t`
  // seat follows the active locale like every other contribution).
  locale.setLocale('en')
  await waitFor(() => { expect(view.getByRole('button', { name: 'Configure: mine' })).toBeTruthy() })
  expect(view.queryByRole('button', { name: 'Configure: standard' })).toBeNull()
})

it('contains a throwing contributor without losing the cards or sibling triggers', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { runtime: r } = await bench()
  await r.mount(GOOD_CHILD)
  await r.mount(CRASH_CHILD)
  const view = r.renderRoot()

  await waitFor(() => { expect(view.getByRole('button', { name: '配置: mine' })).toBeTruthy() })
  // The crashed entry was reported and abdicated; the cards, the built-in
  // actions, and the sibling contribution all survive.
  expect(console.error).toHaveBeenCalledWith(
    expect.stringContaining("slot entry crashed in 'settings.agentPreset.card.action'"), expect.any(Error),
  )
  expect(view.getAllByRole('button', { name: viewButton })).toHaveLength(2)
  expect(view.getByRole('button', { name: '配置: mine' })).toBeTruthy()
  expect(view.queryByRole('button', { name: '配置: standard' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '配置: mine' }))
})

it('removes the contribution with its fiber while the roster keeps rendering', async () => {
  const { runtime: r } = await bench()
  const child = await r.mount(GOOD_CHILD)
  const view = r.renderRoot()

  await waitFor(() => { expect(view.getByRole('button', { name: '配置: mine' })).toBeTruthy() })
  await child.dispose()
  await waitFor(() => { expect(view.queryAllByRole('button', { name: /^配置:/ })).toHaveLength(0) })
  expect(view.getAllByRole('button', { name: viewButton })).toHaveLength(2)
  const anchors = view.container.querySelectorAll('[data-slot="settings.agentPreset.card.action"]')
  for (const anchor of anchors) {
    expect(anchor.childElementCount).toBe(0)
  }
})
