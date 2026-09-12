/**
 * Durable right-panel open state: the bridge between each minted surface
 * store (the live source) and the Host user-settings section (the durable
 * layer).
 *
 * Only explicit user gestures persist - the strip's toggle, an expand
 * button, any open - never the responsive auto-close: the seat closes the
 * panel without a track when the frame cannot hold one, and that concession
 * must not rewrite the user's choice. The responsive close is the sole
 * `setExpanded(false)` caller, so the wrap can tell the two apart by the
 * action alone. On a ready Host section the column reopens where the user
 * left it, unless the user has already acted (touched) this boot, and the
 * seat's responsive rule still wins over the restored value on a narrow
 * frame.
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EXPANDED_FIELD, type PanelSettings } from '../panel-settings.ts'
import type { SurfaceActions } from './service.ts'
import { GLOBAL_SURFACE_KEY, type createSidebarRightStore } from './stores.ts'

/** One minted surface store as this policy addresses it. */
type SurfaceInstance = ReturnType<ReturnType<typeof createSidebarRightStore>['create']>

/** One tracked instance: the surface key it was minted under and its registers. */
interface Tracked {
  readonly instance: SurfaceInstance
  readonly surfaceKey: SessionId
  readonly raw: SurfaceActions
  /** Whether a user gesture has persisted this boot; restores skip acted surfaces. */
  touched: boolean
  off: () => void
}

/**
 * Sync each surface's expanded state with its durable section. Wraps every
 * minted instance so gesture commits persist; restores the stored open state
 * to the boot Session's surface when it materializes, once and before any
 * gesture (the session-independent surface never restores).
 * @param scope - the durable section, or undefined in compositions without
 *   the settings transport (everything then stays process-local).
 */
export class PanelOpenPreference {
  private readonly tracked = new Map<SessionId, Tracked>()
  private lastPersisted: boolean | null | undefined
  /** An outcome committed before the section loaded; flushed once it is ready. */
  private pending: boolean | undefined
  private readonly offScope: (() => void) | undefined
  private disposed = false
  /**
   * Whether the boot surface already received its stored state. Only the
   * first surface to materialize is restored: surfaces minted later — a new
   * Session — own their open state and start collapsed, so one user's
   * column choice never leaks into another session's surface.
   */
  private restored = false
  /** Whether any user gesture happened this boot; the user's action supersedes any restore. */
  private userActed = false

  constructor(private readonly scope: SettingsScope<PanelSettings> | undefined) {
    if (scope !== undefined) {
      this.offScope = scope.subscribe(() => { this.restoreAll(); this.flushPending() })
      this.restoreAll()
      this.flushPending()
    }
  }

  /**
   * Wrap one minted instance: the gesture actions persist their outcome, and
   * the instance's commits drive the restore of a surface materialized after
   * the section loaded.
   * @param instance - the instance the slot runtime minted.
   * @param surfaceKey - the scope key it was minted under.
   * @returns the same instance with the gesture actions wrapped.
   */
  wrap<T extends SurfaceInstance>(instance: T, surfaceKey: SessionId): T {
    const raw = instance.actions
    const tracked: Tracked = { instance, surfaceKey, raw, touched: false, off: () => {} }
    tracked.off = instance.subscribe(() => { this.restore(tracked) })
    this.tracked.set(surfaceKey, tracked)
    const persist = (sessionId: SessionId): void => {
      const surface = instance.getSnapshot().bySession[sessionId]
      if (surface === undefined) return
      this.persist(surface.layout.expanded)
    }
    // A gesture marks the surface touched BEFORE the raw commit: the commit's
    // own synchronous notify would otherwise let the restore re-expand the
    // column the gesture is collapsing.
    const gesture = (sessionId: SessionId, act: () => void): void => {
      tracked.touched = true
      // The gesture is the user's current truth: after any explicit action no
      // surface restores from the section until the next boot.
      this.userActed = true
      act()
      persist(sessionId)
    }
    return {
      ...instance,
      actions: {
        ...raw,
        toggleExpanded: (sessionId: SessionId): void => {
          gesture(sessionId, () => { raw.toggleExpanded(sessionId) })
        },
        setExpanded: (sessionId: SessionId, expanded: boolean): void => {
          // Only an explicit expand is a user gesture; the responsive
          // auto-close (the sole false caller) must never reach the durable
          // preference.
          if (expanded) gesture(sessionId, () => { raw.setExpanded(sessionId, expanded) })
          else raw.setExpanded(sessionId, expanded)
        },
        openContent: (sessionId: SessionId, intent: Parameters<SurfaceActions['openContent']>[1], settled: Parameters<SurfaceActions['openContent']>[2]): void => {
          // An open reveals the column in the same intent; the opened surface
          // is the user's explicit choice to show the panel.
          gesture(sessionId, () => { raw.openContent(sessionId, intent, settled) })
        },
      },
    }
  }

  /** Release every subscription; wrapped gestures become inert with it. */
  dispose(): void {
    this.disposed = true
    this.offScope?.()
    for (const tracked of this.tracked.values()) tracked.off()
    this.tracked.clear()
  }

  private restoreAll(): void {
    for (const tracked of this.tracked.values()) this.restore(tracked)
  }

  private restore(tracked: Tracked): void {
    if (this.restored || this.userActed || tracked.touched) return
    // The session-independent surface materializes first on a boot that goes
    // on to select a Session; restoring it would spend the one restore on a
    // surface the user never sees and leave the Session's column collapsed.
    // A session-less window opens collapsed, as it always has.
    if (tracked.surfaceKey === GLOBAL_SURFACE_KEY) return
    if (this.scope?.getSnapshot().value?.rightbarExpanded !== true) return
    const surface = tracked.instance.getSnapshot().bySession[tracked.surfaceKey]
    if (surface === undefined || surface.layout.expanded) return
    // The raw action: the restore is an adoption, never a gesture, so it can
    // neither persist nor mark the surface touched. The seat's responsive
    // rule still closes the panel afterwards if the frame cannot hold it.
    this.restored = true
    tracked.raw.setExpanded(tracked.surfaceKey, true)
  }

  private flushPending(): void {
    const value = this.pending
    this.pending = undefined
    if (value !== undefined) this.persist(value)
  }

  private persist(expanded: boolean): void {
    if (this.disposed || this.scope === undefined) return
    if (expanded === this.lastPersisted) return
    // An outcome committed while the section is still loading is remembered
    // and flushed once the first accepted view stands.
    if (this.scope.getSnapshot().status !== 'ready') {
      this.pending = expanded
      return
    }
    this.lastPersisted = expanded
    void this.scope.set(EXPANDED_FIELD, expanded)
  }
}
