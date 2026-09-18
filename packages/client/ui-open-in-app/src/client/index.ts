/**
 * Browser half of open-in-app: one Session-header split button opening the
 * session's workspace directory (the summary's `cwd`) in the remembered
 * installed application. Availability is read per workspace path from the host
 * apps route, so a remote mirror path claimed by a host provider shows that
 * provider's catalog and remote tooltip; the last choice persists in the
 * browser through the controller's persisted snapshot store.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { OPEN_IN_APP_ICON_PREFIX } from '@deepseek-ai/dsh-host-open-in-app/shared'
import { OpenInAppController } from './controller.ts'
import { OpenInAppAction, type OpenInAppActionInjected } from './OpenInAppAction.tsx'
import { en, NS, zh, type OpenInAppKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-header "open workspace in application" copy. */
    'open-in-app': OpenInAppKey
  }
}

export type { OpenInAppActionInjected, OpenInAppActionProps } from './OpenInAppAction.tsx'

/** Required services for locale registration and the header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header split button.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new OpenInAppController()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-in-app: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'open-in-app',
    order: -10,
    locale: NS,
    inject: (): OpenInAppActionInjected => ({
      hooks: {
        openInAppAvailability: controller.availability,
        openInAppChoice: controller.choice,
      },
      load: (path, sessionId) => controller.load(path, sessionId),
      launch: (appId, path, sessionId) => controller.launch(appId, path, sessionId),
      choose: (appId) => { controller.choose(appId) },
      iconUrl: appId => `${OPEN_IN_APP_ICON_PREFIX}/${appId}`,
    }),
  }, OpenInAppAction))
}
