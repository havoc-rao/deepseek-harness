/**
 * Durable right-panel width preference: the bridge between the layout store
 * (the live source) and the Host user-settings section (the durable layer).
 *
 * Writes happen only at user commit points — a finished drag, or the first
 * materialization that fixes the derived first-open width — never mid-gesture,
 * never the responsive concessions, and never an adopted value: the equality
 * guard in both directions keeps adoption and persistence from echoing.
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { RIGHTBAR_FIELD, type LayoutSettings } from '../layout-settings.ts'
import type { createLayoutStore } from './stores.ts'

/** The layout store's live instance as this policy addresses it. */
type LayoutInstance = ReturnType<ReturnType<typeof createLayoutStore>['create']>

/**
 * Sync the layout store's right-panel width preference with its durable
 * section. Adopts on every scope change while the store still holds no
 * preference, and persists at each user commit point.
 * @param store - the root layout instance the frame drives.
 * @param scope - the durable section, or undefined in compositions without the
 *   settings transport (everything then stays process-local).
 */
export class RightbarPreferenceSync {
  /** Last value known durable: adoption or an earlier persistence. */
  private lastPersisted: number | null | undefined
  /** The store's last committed preference; its null → px move is a commit point. */
  private previous: number | null
  /** A width committed before the section loaded; flushed once it is ready. */
  private pending: number | null | undefined
  /** Suppresses the adoption's own commit, which must never echo back. */
  private adopting = false
  private disposed = false
  private readonly offStore: () => void
  private readonly offScope: (() => void) | undefined

  constructor(
    private readonly store: LayoutInstance,
    private readonly scope: SettingsScope<LayoutSettings> | undefined,
  ) {
    this.previous = store.getSnapshot().layoutInfo.rightbar
    this.offStore = store.subscribe(() => this.observeStore())
    if (scope !== undefined) {
      this.offScope = scope.subscribe(() => { this.adopt(); this.flushPending() })
      this.adopt()
      this.flushPending()
    }
  }

  /** Persist the width at a user commit point — a finished drag. */
  commit(): void {
    this.persist(this.store.getSnapshot().layoutInfo.rightbar)
  }

  /** Stop both subscriptions; a commit after this writes nothing. */
  dispose(): void {
    this.disposed = true
    this.offStore()
    this.offScope?.()
  }

  private observeStore(): void {
    if (this.adopting) return
    const current = this.store.getSnapshot().layoutInfo.rightbar
    // The first materialization fixes the preference: opening the panel writes
    // the derived or previously stored width, exactly as the in-memory store
    // already commits it. Draft mid-gesture writes commit at release instead.
    if (this.previous === null && current !== null) this.persist(current)
    this.previous = current
  }

  private adopt(): void {
    const saved = this.scope?.getSnapshot().value?.rightbar
    if (saved === undefined || saved === null) return
    const current = this.store.getSnapshot().layoutInfo.rightbar
    if (current !== null) return
    // Seed the stored width through the store's own clamping: a preference
    // from a wider frame squeezes exactly as a live drag would.
    this.adopting = true
    try {
      this.store.actions.setRightbar(saved)
    } finally {
      this.adopting = false
    }
    const actual = this.store.getSnapshot().layoutInfo.rightbar
    this.previous = actual
    this.lastPersisted = actual
  }

  private flushPending(): void {
    const value = this.pending
    this.pending = undefined
    if (value !== undefined) this.persist(value)
  }

  private persist(current: number | null): void {
    if (this.disposed || this.scope === undefined) return
    if (current === null || current === this.lastPersisted) return
    // A width committed while the section is still loading is remembered and
    // flushed once the first accepted view stands.
    if (this.scope.getSnapshot().status !== 'ready') {
      this.pending = current
      return
    }
    this.lastPersisted = current
    void this.scope.set(RIGHTBAR_FIELD, current)
  }
}
