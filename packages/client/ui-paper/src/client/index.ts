/**
 * Browser paper-tone feature over the ui-theme service. The plugin owns the
 * visual layer table (contributed into ThemeRuntime so the composed snapshot
 * folds it), the settings row copy, and the row store; the service owns the
 * durable `paper` preference, the write route, and the snapshots. Registering
 * the row into the settings General section keeps the theme feature's
 * settings surface pattern: the feature owns its surface.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the theme service's Context merge (ctx.theme) and its
// snapshot type. Collaboration goes through the service, never a value
// import (client bundle purity gate).
import type {
  ThemeSnapshot,
} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PaperRowInjected } from './PaperToneRow.tsx'
import { PaperToneRow } from './PaperToneRow.tsx'
import { createPaperRowStore } from './settings-store.ts'
import { en, zh, type PaperKey } from './locales.ts'
import { PAPER_TONE_LAYERS } from '../paper-tones.ts'

export type { PaperRowInjected, PaperToneRowComponentProps } from './PaperToneRow.tsx'
export type { PaperRowState } from './settings-store.ts'
export type { PaperKey } from './locales.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.paper'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The paper-tone settings row's copy. */
    'settings.paper': PaperKey
  }
}

/**
 * Required services: the theme capability plus slots and locale for the
 * settings row. The paper-tone layer table is a same-package contribution.
 */
export const inject = ['slots', 'locale', 'theme']

/**
 * Client plugin body: contribute the paper-tone layer table into the theme
 * service and register the feature-owned settings row into the General
 * section's item slot.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  // One contribution per runtime; the effect disposer clears it on unload or
  // HMR collapse, leaving the service inert (no tint) but consistent.
  ctx.effect(() => ctx.theme.registerPaperToneLayers(PAPER_TONE_LAYERS), 'ui-paper: paper-tone layers')

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-paper: settings row dictionaries')

  const store = createPaperRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: ThemeSnapshot): void => {
    bound?.sync(snapshot.paper, snapshot.revision)
  }
  ctx.on('theme/change', sync)
  const injected = (actions: BoundActions<typeof store>): PaperRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync(ctx.theme.getTheme())
    return {
      setPaper: (tone) => { ctx.theme.setPaper(tone) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'paper-tone',
    order: 11,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, PaperToneRow))
}
