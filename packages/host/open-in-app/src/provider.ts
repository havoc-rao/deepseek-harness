/**
 * Workspace open-target provider extension point. A host-side plugin claims
 * session workspace paths it owns — a remote host's local mirror directory,
 * for example — and supplies the catalog application ids that open the real
 * workspace there. The registry is published as `ctx.openInApp`; other plugins
 * read it with `ctx.get('openInApp')` and degrade to their own behavior when
 * it is absent.
 *
 * The browser half registers nothing: claiming happens on the host, where the
 * workspace path and the launch both live.
 */

/** One workspace target a provider claims: who it is, in human terms, and how it can be opened. */
export interface OpenInAppTarget {
  /** Id of the claiming provider; equals {@link OpenInAppProvider.id}. */
  readonly provider: string
  /** Human-readable source label (for example `root@host:/srv/app`). */
  readonly label: string
  /** Catalog application ids available on this target, in menu order. */
  readonly apps: readonly string[]
}

/** Workspace path and optional session a provider resolves or launches for. */
export interface OpenInAppTargetInput {
  /** Absolute session workspace directory. */
  readonly path: string
  /** Session that owns the workspace, when the caller knows it. */
  readonly sessionId?: string | undefined
}

/** One application launch on a claimed target. */
export interface OpenInAppTargetLaunch extends OpenInAppTargetInput {
  /** Catalog application id from the claimed target's `apps`. */
  readonly app: string
}

/**
 * Host-side plugin that claims workspace directories and launches applications
 * on them. `resolve` answers null to decline a path — the route then uses the
 * built-in local behavior — and a claimed target's launches go only through
 * this provider's `launch`: a failed launch is reported as a failure and never
 * falls back to opening the mirror path locally.
 */
export interface OpenInAppProvider {
  /** Stable provider id, unique per composition. */
  readonly id: string
  /**
   * Claim one workspace path.
   * @param input - the absolute path and optional session to resolve.
   * @returns the claimed target, or null when this provider does not own the path.
   */
  resolve(input: OpenInAppTargetInput): Promise<OpenInAppTarget | null>
  /**
   * Launch one application on a claimed target.
   * @param input - the target path, session, and catalog application id.
   * @returns after the launch is dispatched; rejects on any failure.
   */
  launch(input: OpenInAppTargetLaunch): Promise<void>
}

/** Host-side service published as `ctx.openInApp`. */
export interface OpenInAppService {
  /**
   * Register one workspace target provider.
   * @param provider - the provider to consult on every path-aware request.
   * @returns a disposer that unregisters the provider; wire it through the
   *   registering plugin's own `ctx.effect` so it leaves with that plugin.
   */
  registerProvider(provider: OpenInAppProvider): () => void
}

/** A claimed target together with the provider whose `launch` owns it. */
export interface OpenInAppClaim {
  readonly provider: OpenInAppProvider
  readonly target: OpenInAppTarget
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Open-in-app workspace target providers registered by other host plugins. */
    openInApp: OpenInAppService
  }
}

/** Settle with the provider's answer, or reject once its resolve deadline passes. */
async function withDeadline<T>(work: Promise<T>, deadlineMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(`provider resolve timed out after ${deadlineMs}ms`)) }, deadlineMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Provider registry backing the published `openInApp` service. It consults
 * providers in registration order and treats a throwing or too-slow provider
 * as declining the path, so one broken provider never takes down the button.
 */
export class OpenInAppProviderRegistry {
  private readonly providers: OpenInAppProvider[] = []
  private readonly resolveDeadlineMs: number

  /**
   * @param resolveDeadlineMs - per-provider deadline for one `resolve` call.
   */
  constructor(resolveDeadlineMs: number) {
    this.resolveDeadlineMs = resolveDeadlineMs
  }

  /** The `ctx.openInApp` face; only registration is public. */
  readonly service: OpenInAppService = {
    registerProvider: provider => this.register(provider),
  }

  /**
   * Register one provider; duplicate ids fail loud at the registration site.
   * @param provider - the provider to consult on every path-aware request.
   * @returns a disposer removing this exact registration.
   */
  register(provider: OpenInAppProvider): () => void {
    if (this.providers.some(registered => registered.id === provider.id)) {
      throw new Error(`an open-in-app provider "${provider.id}" is already registered`)
    }
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index >= 0) this.providers.splice(index, 1)
    }
  }

  /**
   * Ask providers, in registration order, which owns one workspace path.
   * @param input - the absolute path and optional session to resolve.
   * @returns the first claim, or null when every provider declined.
   */
  async claim(input: OpenInAppTargetInput): Promise<OpenInAppClaim | null> {
    for (const provider of [...this.providers]) {
      let target: OpenInAppTarget | null
      try {
        target = await withDeadline(provider.resolve(input), this.resolveDeadlineMs)
      } catch {
        // Swallows a provider's rejection or deadline: declining is the
        // documented way to leave the path to the built-in local target.
        continue
      }
      if (target !== null) return { provider, target }
    }
    return null
  }
}
