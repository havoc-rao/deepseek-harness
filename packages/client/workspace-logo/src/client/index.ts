/**
 * Workspace-logo surface plugin, browser half. Fills ui-workspace's three
 * workspace-row holes — the leading 16px cell (`workspaceIcon`), the
 * ellipsis-menu footer (`workspaceMenu`), and the hover-card header
 * (`workspaceHoverIcon`) — with the workspace logo image, the image picker,
 * and the durable Host commit. Mounting this package composes the whole
 * surface from one cordis.yml row; without it the holes stay empty and the
 * row core keeps the folder glyph / title-only card.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the workspace-row holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type WorkspaceLogoKey } from './locales.ts'
import { buildInjected, LOCALE_NS, type WorkspaceLogoInjected } from './face.ts'
import { WorkspaceHoverLogo, WorkspaceLogoCell, WorkspaceLogoMenuEntry } from './logo.tsx'

export type { WorkspaceLogoKey } from './locales.ts'
export type { WorkspaceLogoInjected } from './face.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace-logo surface's copy. */
    'workspace-logo': WorkspaceLogoKey
  }
}

/** Required services (cordis fiber inject): slots, workspaces, locale. */
export const inject = ['slots', 'workspaces', 'locale']

/**
 * Client plugin body: register the surface's dictionaries and its three
 * row-hole occupants through `slots.inject()` because the ui-workspace entry
 * may activate later or replace its declaration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'workspace-logo: dictionaries')

  /* v8 ignore next -- the inject factory body runs only when the renderer
     materializes the hole, which the unit lane cannot reach; the face
     itself is covered directly through face.ts. */
  const injected = (): WorkspaceLogoInjected => buildInjected(ctx)
  // The three occupants are independent contributions; each waits on its own
  // declaration lifetime.
  ctx.slots.inject('sidebar.workspaces.workspaceIcon', () => ctx.slots.register(
    { name: 'sidebar.workspaces.workspaceIcon', inject: injected },
    WorkspaceLogoCell,
  ))
  ctx.slots.inject('sidebar.workspaces.workspaceMenu', () => ctx.slots.register(
    { name: 'sidebar.workspaces.workspaceMenu', inject: injected },
    WorkspaceLogoMenuEntry,
  ))
  ctx.slots.inject('sidebar.workspaces.workspaceHoverIcon', () => ctx.slots.register(
    { name: 'sidebar.workspaces.workspaceHoverIcon', inject: injected },
    WorkspaceHoverLogo,
  ))
}
