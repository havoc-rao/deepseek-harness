/**
 * Desktop window zoom decision. Electron's `viewMenu` zoom roles register only
 * `CommandOrControl+Plus`, which a plain Cmd+= press does not match on macOS
 * (the accelerator is the literal '+' character), so this shell intercepts the
 * chord itself in before-input-event and applies the same level step the role
 * would. Matching is code-based (`Equal`/`Minus`/`Digit0`), layout-independent,
 * and takes the platform modifier — Cmd on macOS, Ctrl elsewhere — mirroring
 * the menu roles.
 * @module @deepseek-ai/dsh-electron/zoom
 */
import type { Input } from 'electron'

/** The inputs a zoom chord is read from; the structural slice of `Electron.Input`. */
export type ZoomChordInput = Pick<Input, 'type' | 'isAutoRepeat' | 'meta' | 'control' | 'alt' | 'shift' | 'code'>

/** One zoom-level step per press, matching Electron's built-in zoom roles. */
export const ZOOM_LEVEL_STEP = 0.5
/** Lowest zoom level (~50%); below this the layout stops being legible. */
export const ZOOM_LEVEL_MIN = -4
/** Highest zoom level (~200%), Chromium's own practical ceiling. */
export const ZOOM_LEVEL_MAX = 4

/**
 * The zoom a key press asks for, or null when it is not a zoom chord.
 * Auto-repeat and alt-modified presses never zoom; on the '0' chord the shift
 * variant is left alone (Cmd+Shift+0 is not the reset gesture).
 * @param input - the intercepted key event.
 * @param platform - local device platform; chooses meta (macOS) or control.
 * @returns 1 to zoom in, -1 to zoom out, 0 to reset, or null to pass through.
 */
export function zoomStepFor(input: ZoomChordInput, platform: NodeJS.Platform): 1 | -1 | 0 | null {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.alt) return null
  const primary = platform === 'darwin' ? input.meta : input.control
  const other = platform === 'darwin' ? input.control : input.meta
  if (!primary || other) return null
  switch (input.code) {
    case 'Equal': return 1
    case 'Minus': return -1
    case 'Digit0': return input.shift ? null : 0
    default: return null
  }
}

/**
 * The next zoom level for one step, clamped to the supported range.
 * @param current - the webContents zoom level before the press.
 * @param step - the step the chord requested.
 * @returns the clamped next level; reset always lands on 0.
 */
export function nextZoomLevel(current: number, step: 1 | -1 | 0): number {
  if (step === 0) return 0
  return Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, current + ZOOM_LEVEL_STEP * step))
}
