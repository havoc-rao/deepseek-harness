/**
 * Desktop-shell detection for the shared web client. The same UI serves
 * plain browsers (`dsh web`) and the Electron desktop shell (apps/electron);
 * the shell marks `documentElement.dataset.shell` before the UI mounts so
 * desktop-only chrome (the window drag strip, macOS traffic-light clearance)
 * activates only under Electron. UA sniffing is the only available channel:
 * the Electron window loads the host webserver over HTTP with no preload
 * bridge, and Electron appends its version to the User-Agent.
 */

/** The desktop shells the web client recognizes; absent for plain browsers. */
export type ShellChrome = 'electron-mac' | 'electron-win' | 'electron-linux'

/**
 * Detect the desktop shell from a User-Agent string.
 * @param ua - the User-Agent to inspect.
 * @returns the shell marker, or `undefined` for a plain browser.
 */
export function detectShellChrome(ua: string): ShellChrome | undefined {
  if (!ua.includes('Electron')) return undefined
  if (/Mac/i.test(ua)) return 'electron-mac'
  if (/Win/i.test(ua)) return 'electron-win'
  return 'electron-linux'
}

/**
 * Mark the shell on `<html>`; call once before the UI mounts (the
 * AppWebEntry constructor). A plain browser leaves the document unmarked.
 * @param ua - the User-Agent to inspect; defaults to `navigator.userAgent`.
 */
export function markShellChrome(ua: string = navigator.userAgent): void {
  const shell = detectShellChrome(ua)
  if (shell === undefined) return
  document.documentElement.dataset.shell = shell
}
