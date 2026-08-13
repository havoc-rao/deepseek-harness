/**
 * dsh desktop app entry. Boots the shared 'web' profile inside the Electron
 * main process, loads the host webserver URL in the renderer window, and owns
 * the Electron lifecycle (window closed → host dispose → quit).
 */
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { startHost, type StartedHost } from './host.ts'
import { createWindow } from './window.ts'

let host: StartedHost | undefined
let quit = false

app.whenReady().then(async () => {
  const environment = loadLayeredEnv('dsh')
  const patchFiles = [fileURLToPath(new URL('../config/electron.patch.yml', import.meta.url))]
  host = await startHost({
    environment,
    patchFiles,
    exit: (code) => {
      quit = true
      void app.exit(code)
    },
  })
  const win = createWindow(host.url)
  win.on('closed', () => {
    if (BrowserWindow.getAllWindows().length === 0) void app.quit()
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'crashed' || details.reason === 'killed') void app.exit(1)
  })
})

app.on('before-quit', (event) => {
  if (quit || host === undefined) return
  event.preventDefault()
  void (async () => {
    await host?.dispose()
    quit = true
    app.quit()
  })()
})

app.on('window-all-closed', () => {
  void app.quit()
})

// The renderer must never reach anything outside the host origin.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})
