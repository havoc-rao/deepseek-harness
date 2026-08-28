/**
 * Paper-tone row slot store: a mirror of the theme service snapshot's tone.
 * The plugin's apply-world change listener is the only writer; the row
 * component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { PaperTone } from '@deepseek-ai/dsh-client-ui-theme'

/** Store state mirrored from the theme snapshot. */
export interface PaperRowState {
  /** Persisted paper tone (selection state reads this, independent of the preference). */
  paper: PaperTone
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type PaperRowActions = {
  sync: (draft: PaperRowState, paper: PaperTone, revision: number) => void
}

/**
 * Declares the paper-tone row state and write surface.
 * @returns the store handle.
 */
export function createPaperRowStore(): EngineStoreHandle<PaperRowState, PaperRowActions> {
  return defineStore({
    init: (): PaperRowState => ({ paper: 'default', revision: -1 }),
    actions: {
      sync: (d, paper: PaperTone, revision: number) => {
        if (revision <= d.revision) return
        d.paper = paper
        d.revision = revision
      },
    },
  })
}
