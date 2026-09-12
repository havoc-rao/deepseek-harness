/**
 * Right-panel width row store: a mirror of the layout store's live
 * preference, written only by the plugin's apply-world sync. The row
 * component reads via props.useStore; no other writer exists.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { RIGHTBAR_MIN } from '../columns.ts'

/** Row state mirrored from the layout store's live preference. */
export interface RightPanelWidthRowState {
  /** Live width preference in px: the stored width, or the derived first-open width. */
  width: number
  /** Largest width the current frame admits in px: 70% of the viewport. */
  max: number
}

/** Declared action shape giving the exported factory a stable return type. */
type RightPanelWidthRowActions = {
  sync: (draft: RightPanelWidthRowState, width: number, max: number) => void
}

/**
 * Declares the row state and write surface.
 * @returns the store handle.
 */
export function createRightPanelWidthRowStore(): EngineStoreHandle<RightPanelWidthRowState, RightPanelWidthRowActions> {
  return defineStore({
    init: (): RightPanelWidthRowState => ({ width: RIGHTBAR_MIN, max: RIGHTBAR_MIN }),
    actions: {
      sync: (d, width: number, max: number) => {
        if (d.width === width && d.max === max) return
        d.width = width
        d.max = max
      },
    },
  })
}
