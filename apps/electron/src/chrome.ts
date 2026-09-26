/**
 * Window chrome constants shared between the main process window options
 * (window.ts) and the preload's document marks (preload.ts), so the native
 * caption overlay height and the CSS variable that mirrors it cannot drift.
 * @module @deepseek-ai/dsh-electron/chrome
 */

/** Windows caption overlay height in DIPs; the preload publishes it as `--dsh-windows-titlebar-height`. */
export const WINDOWS_TITLEBAR_HEIGHT = 36

/** macOS traffic-light inset, DIPs from the window's top-left corner. */
export const MACOS_TRAFFIC_LIGHT_POSITION = { x: 12, y: 8 } as const
