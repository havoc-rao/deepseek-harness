/**
 * Browser-local user preferences for the layout plugin.
 *
 * Only the right panel width persists: every other value in the layout store
 * is transient by design — the sidebar forgets its dragged width on close so
 * reopening restores the contract default, responsive concessions never
 * rewrite preferences, and the right panel's expanded state is the occupant's
 * own recorded business. The width is the one preference a user re-creates
 * by hand after every reload, so the apply side effects read it once at
 * store creation and write it on every committed change.
 */
import { RIGHTBAR_MIN } from './columns.ts'

/** localStorage key for the dragged/staged right panel width preference (px). */
export const RIGHTBAR_PREFERENCE_KEY = 'dsh.layout.rightbarWidth'

/**
 * Read a valid persisted right panel width, or null when absent, unreadable,
 * or outside the contract range.
 * @returns the width preference, or null when storage has no usable value.
 */
export function readRightbarPreference(): number | null {
  if (typeof localStorage === 'undefined') return null
  let raw: string | null
  try { raw = localStorage.getItem(RIGHTBAR_PREFERENCE_KEY) }
  catch (_storageUnavailable) { return null }
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= RIGHTBAR_MIN ? value : null
}

/**
 * Persist the right panel width preference.
 * @param width - the width to remember; rewritten on every committed change.
 */
export function writeRightbarPreference(width: number): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(RIGHTBAR_PREFERENCE_KEY, `${width}`) }
  catch (error) { console.error('Rightbar width preference persistence failed:', error) }
}
