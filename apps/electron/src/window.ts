/**
 * The single renderer window, hardened for a localhost surface: sandboxed web
 * contents, no node integration, navigation pinned to the host origin, and
 * every external link handed to the system browser.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, shell } from 'electron'

/** App icon: .ico on Windows (multi-res ICO), PNG elsewhere. macOS dock icon is set separately. */
const ICON_FILE = process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'

export function createWindow(baseUrl: string, dev: boolean): BrowserWindow {
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
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault()
  })
  void win.loadURL(`${baseUrl}/`)
  return win
}
