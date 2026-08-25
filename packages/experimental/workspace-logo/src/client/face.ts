/**
 * The logo surface's inject face and its builder. Internal module: the /client
 * entrypoint re-exports only the face TYPE; the builder stays importable by
 * same-package tests through the `./src/*` subpath.
 */
import type { ClientContext, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** The logo surface's business face: the durable Host commit plus the bound locale seat. */
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

/** Locale namespace owning the logo surface's copy. */
export const LOCALE_NS = 'workspace-logo'

/**
 * Build the inject face from the apply closure's services.
 * @param ctx - client root context.
 * @returns the face.
 */
export function buildInjected(ctx: ClientContext): WorkspaceLogoInjected {
  return {
    pick: (workspaceId, dataUrl) => {
      ctx.workspaces.setLogo(workspaceId, dataUrl).catch((reason: unknown) => {
        console.warn('workspace logo set rejected:', reason)
      })
    },
    t: ctx.locale.bind(LOCALE_NS),
  }
}
