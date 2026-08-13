/**
 * The single renderer window, hardened for a localhost surface: sandboxed web
 * contents, no node integration, navigation pinned to the host origin, and
 * every external link handed to the system browser.
 */
import { BrowserWindow, shell } from 'electron'

export function createWindow(baseUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0b0d10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
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
