/** Durable layout preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import { RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN } from './client/columns.ts'

/** Settings namespace owned by the layout plugin. */
export const LAYOUT_SETTINGS_NAMESPACE = 'ui-layout'

/** Field carrying the saved right-panel width preference. */
export const RIGHTBAR_FIELD = 'rightbar'

/** Largest frame the schema admits at the 70% ceiling: an 8K viewport (7680px)
 * at RIGHTBAR_MAX_RATIO. The frame solve re-clamps to the live viewport per
 * render, so this only keeps the wire honest, never shapes the layout. */
export const RIGHTBAR_PERSIST_MAX = RIGHTBAR_MAX_RATIO * 7680

/** Durable layout section shared by the Host schema and the browser scope. */
export interface LayoutSettings {
  /** Saved right-panel width in px; absent while the first-open rule derives it. */
  rightbar?: number | null
}

/** Durable layout schema; also the wire envelope the browser scope validates against. */
export const LayoutSettingsSchema: z<LayoutSettings> = z.object({
  // Absent while unset: this schemastery fork treats a null default as no
  // default, so "unset" is a missing field, never an explicit null.
  [RIGHTBAR_FIELD]: z.union([
    z.number().step(1).min(RIGHTBAR_MIN).max(RIGHTBAR_PERSIST_MAX),
    z.const(null),
  ]),
})
