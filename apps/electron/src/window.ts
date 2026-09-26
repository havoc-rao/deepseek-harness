/**
 * The single renderer window, hardened for a localhost surface: sandboxed web
 * contents, no node integration, navigation pinned to the host origin, every
 * external link handed to the system browser, and Cmd+W routed through the
 * shortcut router before the window-close confirmation.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainEvent } from 'electron'
import { MACOS_TRAFFIC_LIGHT_POSITION, WINDOWS_TITLEBAR_HEIGHT } from './chrome.ts'
import {
  registerRendererShortcuts,
  SHELL_SHORTCUT_CLAIM_CHANNEL,
  type ShortcutClaimReply,
} from './renderer-shortcuts.ts'
import type { ShortcutRouter } from './shortcuts.ts'
import { nextZoomLevel, zoomStepFor } from './zoom.ts'

/** App icon: .ico on Windows (multi-res ICO), PNG elsewhere. macOS dock icon is set separately. */
const ICON_FILE = process.platform === 'win32' ? 'icon.ico' : 'icon-512.png'

/**
 * Window chrome per platform. The desktop shell hides the OS title bar and
 * the web UI owns the top drag target: a chrome row marks itself
 * `data-window-drag` and ui-web base.css's one darwin rule (gated on the
 * `data-platform` mark the preload sets) declares `-webkit-app-region: drag`
 * over that row's own box — the sidebar top strip and logo row, the
 * conversation header, the dockkit tab strip, and the entry-page heads.
 * macOS keeps the traffic lights in the window's own top row above the
 * sidebar's strip; the sidebar vibrancy material needs a transparent window
 * background to show through the page, exactly as the product shell does.
 * Windows keeps the native min/max/close buttons via the title-bar overlay
 * and drags through AppFrame's caption band (`data-windows-titlebar`, also
 * preload-set); Linux keeps the default frame.
 */
const CHROME = process.platform === 'darwin'
  ? {
    titleBarStyle: 'hiddenInset' as const,
    trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
    vibrancy: 'sidebar' as const,
    visualEffectState: 'active' as const,
    backgroundColor: '#00000000' as const,
  }
  : process.platform === 'win32'
    ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#0b0d10', symbolColor: '#e8e8e8', height: WINDOWS_TITLEBAR_HEIGHT },
    }
    : {}

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
  // The initial load carries the process launch token; the index route then
  // redirects to the token-free root. Navigation and window opens are fenced
  // by origin, not by the token-bearing URL.
  const origin = new URL(baseUrl).origin
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0b0d10',
    icon: join(fileURLToPath(new URL('../assets/', import.meta.url)), ICON_FILE),
    ...CHROME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The sandboxed preload (lib/preload.cjs) exposes dshDesktopShell: the
      // page-side half of the shortcut bridge. The path resolves from both
      // layouts: src/window.ts and lib/main.js both sit one level under
      // apps/electron, so `../lib/preload.cjs` is the built artifact either way.
      preload: join(fileURLToPath(new URL('../lib/preload.cjs', import.meta.url))),
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
    if (url.startsWith(origin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault()
  })
  // Cmd+=/Cmd+-/Cmd+0 (Ctrl elsewhere) zoom the whole window. The built-in
  // View menu registers only 'CommandOrControl+Plus' for zoom-in, which a
  // plain '=' press does not match on macOS, so the chord is intercepted here
  // with code-based matching (layout-independent) and the same level step the
  // menu role would apply.
  let routingCloseShortcut = false
  win.webContents.on('before-input-event', (event, input) => {
    const step = zoomStepFor(input, process.platform)
    if (step !== null) {
      event.preventDefault()
      win.webContents.setZoomLevel(nextZoomLevel(win.webContents.getZoomLevel(), step))
      return
    }
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
  // The renderer shortcut bridge: the page claims Cmd+W (closing its active
  // tab) through dshDesktopShell. Only this window's webContents receives
  // the ask; the claim listener is global and routes replies by request id,
  // so other windows ignore them. The bridge's own `closed` hook unregisters
  // the router handler; this listener is removed alongside it.
  if (shortcuts !== undefined) {
    const { bridge } = registerRendererShortcuts(win, shortcuts)
    const onClaim = (_event: IpcMainEvent, payload: unknown): void => {
      // The payload comes from our own preload; a malformed shape settles no
      // ask (its request id matches nothing) and is dropped.
      bridge.receiveClaim(payload as ShortcutClaimReply)
    }
    ipcMain.on(SHELL_SHORTCUT_CLAIM_CHANNEL, onClaim)
    win.on('closed', () => { ipcMain.off(SHELL_SHORTCUT_CLAIM_CHANNEL, onClaim) })
  }
  void win.loadURL(baseUrl)
  return win
}
