/**
 * Workspace-logo surface plugin, browser half. Fills ui-workspace's three
 * workspace-row holes — the leading 16px cell (`workspaceIcon`), the
 * ellipsis-menu footer (`workspaceMenu`), and the hover-card header
 * (`workspaceHoverIcon`) — with the logo image, picker, and durable Host
 * commit. Mounting this package composes the whole surface from one
 * cordis.yml row; without it the holes stay empty and the row core keeps the
 * folder glyph / title-only card.
 */
import type { ClientContext, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the workspace-row holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type WorkspaceLogoKey } from './locales.ts'
import { WorkspaceHoverLogo, WorkspaceLogoCell, WorkspaceLogoMenuEntry } from './logo.tsx'

export type { WorkspaceLogoKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace-logo surface's copy. */
    'workspace-logo': WorkspaceLogoKey
  }
}

/** Locale namespace owning the logo surface's copy. */
const NS = 'workspace-logo'

/**
 * The logo surface's business face: the durable Host commit plus the bound
 * locale seat.
 */
export type WorkspaceLogoInjected = {
  /**
   * Commit a picked logo data URL to the Host durably; failures are
   * non-fatal console diagnostics (the returned view redraws the row).
   * @param workspaceId - target workspace.
   * @param dataUrl - the picked image as a data URL.
   */
  pick: (workspaceId: WorkspaceId, dataUrl: string) => void
  /** Bound locale seat for this package's namespace. */
  t: TranslateNS<'workspace-logo'>
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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-logo: dictionaries')

  const injected = (): WorkspaceLogoInjected => ({
    pick: (workspaceId, dataUrl) => {
      ctx.workspaces.setLogo(workspaceId, dataUrl).catch((reason: unknown) => {
        console.warn('workspace logo set rejected:', reason)
      })
    },
    t: ctx.locale.bind(NS),
  })
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
