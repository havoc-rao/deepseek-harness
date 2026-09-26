/**
 * The application menu template. The desktop app owns its menu explicitly:
 * without a `Menu.setApplicationMenu` call Electron installs the default
 * menu, whose File > Close Window (Cmd+W on macOS, Ctrl+W elsewhere) would
 * close the window straight from the menu accelerator — ahead of the
 * before-input-event interception in window.ts, so even a claiming page
 * consumer could not stop it. Every window-close intent therefore routes
 * through the shortcut router alone, and this template must not offer a
 * close item at all. Quitting goes through Cmd+Q (the macOS App menu), the
 * window button, or the title-bar control.
 *
 * Roles carry Electron's platform-localized labels and accelerators, so the
 * template hardcodes no copy. `fileMenu` is forbidden on macOS, where it
 * contains Close Window; on Windows/Linux it holds only Quit.
 */
import type { MenuItemConstructorOptions } from 'electron'

/**
 * The application menu template; roles render the platform-localized labels
 * and accelerators. `platform` is injectable so the unit tests can assert
 * every shipping platform without an Electron runtime.
 * @param platform - the platform the menu targets; defaults to the runtime platform.
 */
export function createApplicationMenuTemplate(platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  // macOS requires its App menu first (About / Services / Hide / Quit with
  // Cmd+Q); Windows and Linux carry Quit in the File menu instead.
  return platform === 'darwin'
    ? [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      { role: 'help', submenu: [] },
    ]
    : [
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]
}
