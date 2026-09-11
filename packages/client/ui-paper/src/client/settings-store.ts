/**
 * Paper-tone row slot store: a mirror of the paper preference. The plugin's
 * apply-world scope adoption is the only writer; the row component reads via
 * props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PaperTone } from '../paper-settings.ts'

/** Store state mirrored from the durable paper preference. */
export interface PaperRowState {
  /** Persisted paper tone (selection state reads this, independent of the preference). */
  paper: PaperTone
  /** Adoption revision; -1 until first sync so revision 0 lands as a change. */
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
