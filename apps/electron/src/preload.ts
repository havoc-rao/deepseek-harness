/**
 * Sandboxed preload for the renderer window: the page-side half of the
 * desktop shortcut bridge. Runs in an isolated world before the page under
 * `sandbox: true`, so it may load only electron (contextBridge,
 * ipcRenderer) and must ship as a CommonJS artifact (lib/preload.cjs).
 *
 * Exposes `window.dshDesktopShell.onShortcut(name, handler)`. The main
 * process asks with `dsh:shell-shortcut` (`{ name, requestId }`); this
 * script always answers `dsh:shell-shortcut-claim`
 * (`{ name, requestId, claimed }`, `claimed = handler() === true`). A press
 * with no handler, or a handler that throws, answers `false`, so the main
 * process never waits on a missing page-side consumer.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { WINDOWS_TITLEBAR_HEIGHT } from './chrome.ts'

/**
 * Marks the document root with the host platform so the shared web UI's
 * window-chrome CSS can scope desktop-only rules, mirroring the product
 * shell's preload contract (apps/desktop preload-platform.ts): `data-platform`
 * switches on the darwin drag rows and hiddenInset layout variants, and
 * `data-windows-titlebar` switches on the caption band over the Windows
 * title-bar overlay. Deferred to DOMContentLoaded when the root is absent —
 * the web boot reads and renders these flags well after that, so the marks
 * are always in place before the first chrome row draws.
 */
function markDocumentPlatform(): void {
  const mark = (): void => {
    const root = document.documentElement as HTMLElement | null
    if (root === null) return
    if (process.platform === 'darwin') {
      root.dataset.platform = 'darwin'
    } else if (process.platform === 'win32') {
      root.dataset.windowsTitlebar = ''
      // The caption band's height must match the native overlay (window.ts CHROME).
      root.style.setProperty('--dsh-windows-titlebar-height', `${WINDOWS_TITLEBAR_HEIGHT}px`)
    }
  }
  if ((document.documentElement as HTMLElement | null) === null) {
    window.addEventListener('DOMContentLoaded', mark, { once: true })
  } else {
    mark()
  }
}

type ShortcutHandler = () => boolean | undefined

/** The current handler per shortcut name; a later registration replaces the earlier one. */
const handlers = new Map<string, ShortcutHandler>()

function onShortcut(name: string, handler: ShortcutHandler): () => void {
  handlers.set(name, handler)
  return () => {
    // HMR and duplicate registration can dispose a handler after a newer one
    // replaced it: only the currently registered handler removes itself.
    if (handlers.get(name) === handler) handlers.delete(name)
  }
}

ipcRenderer.on('dsh:shell-shortcut', (_event, payload: { name: string; requestId: string }) => {
  const handler = handlers.get(payload.name)
  let claimed = false
  if (handler !== undefined) {
    try {
      claimed = handler() === true
    } catch {
      // A throwing page handler must not block the close path: answer
      // unclaimed so the window's confirmation dialog stays the default.
      claimed = false
    }
  }
  ipcRenderer.send('dsh:shell-shortcut-claim', { name: payload.name, requestId: payload.requestId, claimed })
})

contextBridge.exposeInMainWorld('dshDesktopShell', {
  onShortcut,
})

markDocumentPlatform()
