/**
 * Browser paper-tone feature over the ui-theme service. The plugin owns the
 * tone vocabulary and durable preference (its own settings namespace), the
 * settings row copy, and the row store; the active tone's visual layer is
 * contributed into the theme service as one `overrideTokens` layer, so the
 * composed snapshot folds it. Registering the row into the settings General
 * section keeps the theme feature's settings surface pattern: the feature
 * owns its surface.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the theme service's Context merge (ctx.theme).
// Collaboration goes through the service, never a value import (client
// bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) the settings-row
// registration goes through.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PaperRowInjected } from './PaperToneRow.tsx'
import { PaperToneRow } from './PaperToneRow.tsx'
import { createPaperRowStore } from './settings-store.ts'
import { en, zh, type PaperKey } from './locales.ts'
import { PAPER_TONE_LAYERS } from '../paper-tones.ts'
import {
  DEFAULT_PAPER, PAPER_SETTINGS_NAMESPACE, PAPER_TONE_FIELD, type PaperSettings, type PaperTone,
} from '../paper-settings.ts'

export type { PaperRowInjected, PaperToneRowComponentProps } from './PaperToneRow.tsx'
export type { PaperRowState } from './settings-store.ts'
export type { PaperKey } from './locales.ts'
export type { PaperSettings, PaperTone } from '../paper-settings.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.paper'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The paper-tone settings row's copy. */
    'settings.paper': PaperKey
  }
}

/**
 * Required services: the theme capability, the settings scope transport for
 * the durable paper preference, and slots and locale for the settings row.
 * The paper-tone layer table is a same-package contribution.
 */
export const inject = ['slots', 'locale', 'theme', 'remote', 'settingsScope']

/**
 * Client plugin body: contribute the active tone's visual layer into the
 * theme service, adopt the durable preference on every scope change, and
 * register the feature-owned settings row into the General section's item
 * slot.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  const host = ctx.settingsScope.bind<PaperSettings>({ namespace: PAPER_SETTINGS_NAMESPACE })

  const store = createPaperRowStore()
  let bound: BoundActions<typeof store> | undefined
  /** Monotonic adoption counter; the store's revision guard drops stale duplicates. */
  let revision = -1
  let disposeLayer: (() => void) | undefined

  /** Read the scope's settled tone; the schema default while the section is still loading. */
  const toneOf = (): PaperTone => host.getSnapshot().value?.[PAPER_TONE_FIELD] ?? DEFAULT_PAPER

  // Re-calling overrideTokens with the same source replaces that source's
  // whole layer; the effect's teardown holds the LATEST disposer, so a fiber
  // collapse (HMR or unload) removes the layer the tone switched to, leaving
  // the service consistent (no tint) with the preference intact.
  const adopt = (): void => {
    const tone = toneOf()
    disposeLayer = ctx.theme.overrideTokens('ui-paper', PAPER_TONE_LAYERS[tone])
    revision += 1
    bound?.sync(tone, revision)
  }
  ctx.effect(() => { adopt(); return () => { disposeLayer?.(); disposeLayer = undefined } }, 'ui-paper: paper-tone layer')
  ctx.effect(() => host.subscribe(() => { adopt() }), 'ui-paper: settings scope adoption')

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-paper: settings row dictionaries')

  const injected = (actions: BoundActions<typeof store>): PaperRowInjected => {
    bound = actions
    // Re-sync from the current adoption so no scope change is lost between
    // registration and first render (the store's revision guard drops stale
    // duplicates).
    bound.sync(toneOf(), revision)
    return {
      setPaper: (tone) => { void host.set(PAPER_TONE_FIELD, tone) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'paper-tone',
    order: 12,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, PaperToneRow))
}
