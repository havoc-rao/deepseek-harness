/**
 * @deepseek-ai/dsh-host-terminal-web — Browser-interactive terminal host.
 *
 * Mounts one WebSocket endpoint per interactive PTY. Each upgraded socket
 * becomes a {@link TerminalSocket} bridge over `ctx.subprocess.spawnTerminal`,
 * so the pty backend composes with whatever subprocess provider the
 * composition mounts. The endpoint lives under `/api` and applies the same
 * browser-trust fence as the client-connection downlinks: loopback is always
 * trusted and configured Host names extend the fence; every other upgrade is
 * rejected before negotiation. Configuring `trustedHosts` here and in
 * `client-connection` must stay in step for LAN clients.
 */

import { Context } from '@deepseek-ai/cordis'
import { isTrustedApiRequest, rejectWebSocketUpgrade } from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { WebSocketServer } from 'ws'
import { TerminalSocket } from './terminal-socket.ts'
// Empty type import carries the webServer/subprocess Context merges.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'

/** Upgrade pathname for the browser terminal endpoint. */
export const TERMINAL_UPGRADE_PATH = '/api/terminals'

/** Cordis plugin name. */
export const name = 'terminal-web'
/** Required services: the pty spawn seam and the web route registry. */
export const inject = ['subprocess', 'webServer']

/** Plugin config: which non-loopback Host names may open the terminal. */
export interface Config {
  /** Browser-trust Host names beyond loopback; mirror `client-connection.trustedHosts`. */
  trustedHosts: string[]
}

/** @inheritdoc */
export const Config: z<Config> = z.object({
  trustedHosts: z.array(z.string()).default([]),
})

/**
 * Register the `/api/terminals` upgrade and own its sockets.
 * @param ctx - Cordis context with `webServer` and `subprocess`.
 * @param config - plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => {
    const wss = new WebSocketServer({ noServer: true })
    const logger = ctx.logger(name)
    const disposeUpgrade = ctx.webServer.registerUpgrade({
      path: TERMINAL_UPGRADE_PATH,
      handler: (req, socket, head) => {
        if (!isTrustedApiRequest(req, config.trustedHosts)) {
          rejectWebSocketUpgrade(socket)
          return
        }
        wss.handleUpgrade(req, socket, head, (websocket) => {
          new TerminalSocket(websocket, spec => ctx.subprocess.spawnTerminal(spec), (message) => {
            logger.info(message)
          })
        })
      },
    })
    return () => {
      disposeUpgrade()
      for (const client of wss.clients) client.terminate()
      wss.close()
    }
  }, `${name}: ${TERMINAL_UPGRADE_PATH}`)
}
