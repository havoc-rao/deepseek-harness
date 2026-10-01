/** Re-send the boot injections to the Electron shell whenever the client graph recomposes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-host-webserver'

/**
 * Publish the current boot injections over the desktop IPC whenever the client
 * module graph recomposes. The shell caches the startup snapshot for every page
 * reload, so without these updates a plugin update (which recomposes the Host
 * graph without restarting the shell) leaves reloads requesting revisions the
 * bundle table has already dropped.
 * @param ctx - desktop Host context carrying the client module registry and web server.
 * @param send - desktop shell message transport; the caller drops the message when the pipe is gone.
 */
export function installInjectionPublisher(ctx: Context, send: (message: object) => void): void {
  const clientModules = ctx.get('clientModules')
  if (clientModules === undefined) return
  clientModules.onGraphChanged(() => {
    send({ type: 'injections', injections: ctx.webServer.collectIndexInjections() })
  })
}
