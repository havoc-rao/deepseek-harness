/** Durable right-panel open preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the right-Sidebar plugin. */
export const PANEL_SETTINGS_NAMESPACE = 'ui-sidebar-right'

/** Field carrying the saved column open state. */
export const EXPANDED_FIELD = 'rightbarExpanded'

/** Durable panel section shared by the Host schema and the browser scope. */
export interface PanelSettings {
  /**
   * The user's explicit column choice: whether the panel was last opened or
   * closed by gesture. Absent while no explicit choice exists (the surface
   * starts collapsed, and responsive closes never write).
   */
  rightbarExpanded?: boolean | null
}

/** Durable panel schema; also the wire envelope the browser scope validates against. */
export const PanelSettingsSchema: z<PanelSettings> = z.object({
  // Absent while unset: this schemastery fork treats a null default as no
  // default, so "unset" is a missing field, never an explicit null.
  [EXPANDED_FIELD]: z.union([z.boolean(), z.const(null)]),
})
