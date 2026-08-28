/**
 * The single renderer window, hardened for a localhost surface: sandboxed web
 * contents, no node integration, navigation pinned to the host origin, every
 * external link handed to the system browser, and Cmd+W routed through the
 * shortcut router before the window-close confirmation.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, dialog, shell } from 'electron'
import type { ShortcutRouter } from './shortcuts.ts'

/** App icon: .ico on Windows (multi-res ICO), PNG elsewhere. macOS dock icon is set separately. */
const ICON_FILE = process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'

/** Guards against a second prompt while one close-confirmation dialog is open. */
let confirmingClose = false

/**
 * Asks before the window closes. The dialog is modal to the window, and
 * closing the window ends the current host session, so the default is Cancel.
 */
async function confirmClose(win: BrowserWindow): Promise<void> {
  if (confirmingClose) return
  confirmingClose = true
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirm Close',
      message: 'Close dsh?',
      detail: 'Closing the window ends the current session.',
    })
    if (response === 0) win.close()
  } catch {
    // The dialog is parented to the window; a rejection only happens when the
    // window is already gone, in which case there is nothing left to close.
  } finally {
    confirmingClose = false
  }
}

export function createWindow(baseUrl: string, dev: boolean, shortcuts: ShortcutRouter | undefined): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0b0d10',
    icon: join(fileURLToPath(new URL('../assets/', import.meta.url)), ICON_FILE),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  // Dev runs (electron:dev sets DSH_ELECTRON_DEV=1) get a `(dev)` title suffix
  // so the window is distinguishable from a plain electron:start / packaged
  // run; the renderer `<title>` arrives via page-title-updated.
  win.on('page-title-updated', (event, title) => {
    if (!dev) return
    event.preventDefault()
    win.setTitle(`${title} (dev)`)
  })
  win.once('ready-to-show', () => { win.show() })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault()
  })
  // Cmd+W is the macOS close shortcut: intercept it before the renderer or the
  // default menu's Close item, route it through the shortcut router, and
  // confirm the window close unless a handler claimed the press.
  let routingCloseShortcut = false
  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown'
      && !input.isAutoRepeat
      && input.meta
      && !input.control
      && !input.alt
      && !input.shift
      && input.key.toLowerCase() === 'w'
    ) {
      event.preventDefault()
      if (routingCloseShortcut) return
      routingCloseShortcut = true
      void (async () => {
        let claimed = false
        try {
          if (shortcuts !== undefined) {
            claimed = (await shortcuts.route('cmd-w')) === 'claimed'
          }
        } catch {
          // A throwing handler must not consume the shortcut silently: fall
          // back to the confirm dialog, the safe default.
        } finally {
          routingCloseShortcut = false
        }
        if (!claimed) await confirmClose(win)
      })()
    }
  })
  void win.loadURL(`${baseUrl}/`)
  return win
}
