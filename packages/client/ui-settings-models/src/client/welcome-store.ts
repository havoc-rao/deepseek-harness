/**
 * Welcome-notice state derived from the welcome settings scope. The scope is
 * the transport: a loopback browser follows the durable Host section, while a
 * remote browser's memory-mode scope never answers and the acknowledgement
 * stays process-local here.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  WELCOME_ACK_LOCAL_KEY, WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_VERSION,
} from '../onboarding-copy.ts'

/** State rendered by the welcome step. */
export interface WelcomeNoticeState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  acknowledged: boolean
  error: string | null
}

/** The welcome section as the notice reads it. */
export type WelcomeSection = Record<string, unknown>

/**
 * Wall-clock budget for one Host acknowledgement write. A Host write that
 * neither settles nor rejects within this budget (an unconnected or empty
 * session can leave the settings RPC pending) is treated as unavailable and
 * falls back to the browser-local acknowledgement instead of stranding the
 * notice in the saving state with a permanently disabled Continue button.
 */
export const WELCOME_ACK_WRITE_TIMEOUT_MS = 5000

/** Browser persistence for the local fallback acknowledgement. */
export type WelcomeLocalStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Options handed to the store (tests inject a fake storage and timeout). */
export interface WelcomeNoticeStoreOptions {
  /** localStorage-like sink for the fallback acknowledgement; defaults to the global when present. */
  storage?: WelcomeLocalStorage
  /** Override for the Host write budget (tests). */
  timeoutMs?: number
}

/**
 * Accept any object section verbatim; a malformed durable value reads as an
 * empty section, so the notice treats it as unacknowledged instead of leaving
 * the scope stuck on its previous value.
 * @param section - the wire section value.
 * @returns the section object, or an empty one for non-object values.
 */
export function decodeWelcomeSection(section: unknown): WelcomeSection {
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    ? section as WelcomeSection
    : {}
}

/* v8 ignore next 3 -- closed-union default only defends future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected welcome settings status')
}

/** Coordinates durable Host acknowledgement or a process-local remote fallback. */
export class WelcomeNoticeStore {
  /** uSES-safe state source shared by the registered welcome step. */
  readonly store: SnapshotStore<WelcomeNoticeState> = createSnapshotStore<WelcomeNoticeState>({
    status: 'idle', acknowledged: false, error: null,
  })

  private localAcknowledged = false
  private saving = false
  private following: (() => void) | undefined
  private readonly storage: WelcomeLocalStorage | undefined
  private readonly timeoutMs: number

  /**
   * @param scope - the welcome settings namespace scope; its memory mode is
   * what keeps a remote browser process-local.
   * @param options - storage sink for the browser-local fallback and the Host
   * write budget (both overridable in tests).
   */
  constructor(
    private readonly scope: SettingsScope<WelcomeSection>,
    options: WelcomeNoticeStoreOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? WELCOME_ACK_WRITE_TIMEOUT_MS
    this.storage = options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    this.localAcknowledged = this.readLocalAck()
  }

  /** Whether the stored fallback equals the current copy version, or false when unreadable. */
  private readLocalAck(): boolean {
    try {
      return this.storage?.getItem(WELCOME_ACK_LOCAL_KEY) === WELCOME_NOTICE_VERSION
    } catch {
      return false
    }
  }

  /** Persist the fallback acknowledgement; failures are swallowed (best-effort only). */
  private writeLocalAck(): void {
    try {
      this.storage?.setItem(WELCOME_ACK_LOCAL_KEY, WELCOME_NOTICE_VERSION)
    } catch {
      this.localAcknowledged = true
    }
  }

  /**
   * Begin following the bound scope (idempotent) and publish its current answer.
   * @returns settlement after the current answer is published.
   */
  load(): Promise<void> {
    this.following ??= this.scope.subscribe(() => { this.derive() })
    this.derive()
    return Promise.resolve()
  }

  /**
   * Persist this copy version, or advance only this process for a remote
   * browser. Success is judged against the state the write left behind, so a
   * refused or failed write reports false after its recovery read settles.
   * A Host write that hangs past the write budget is treated as unavailable:
   * the acknowledgement advances locally ({@link writeLocalAck}) so the notice
   * can close instead of stranding the Continue button in the saving state.
   * @returns true when the selected persistence mode holds the acknowledgement.
   */
  async acknowledge(): Promise<boolean> {
    if (this.scope.getSnapshot().mode === 'memory') {
      this.localAcknowledged = true
      this.writeLocalAck()
      this.derive()
      return true
    }
    this.saving = true
    this.store.update((state) => { state.status = 'saving'; state.error = null })
    try {
      // Race the Host write against the budget: a settle answers authoritative,
      // a timeout falls back locally. The hung promise is left to settle on
      // its own; a late success only flips the scope-derived ack to true.
      const written = await Promise.race([
        this.scope.set(WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_VERSION).then(() => true as const),
        delay(this.timeoutMs).then(() => false as const),
      ])
      if (!written) {
        this.localAcknowledged = true
        this.writeLocalAck()
      }
    } finally {
      this.saving = false
    }
    this.derive()
    const { acknowledged } = this.store.getSnapshot()
    if (!acknowledged) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = 'the acknowledgement did not persist'
      })
    }
    return acknowledged
  }

  /** Stop following the scope. */
  dispose(): void {
    this.following?.()
    this.following = undefined
  }

  private derive(): void {
    if (this.saving) return
    const scope = this.scope.getSnapshot()
    if (scope.mode === 'memory') {
      this.store.update((state) => {
        state.status = 'ready'
        state.acknowledged = this.localAcknowledged
        state.error = null
      })
      return
    }
    switch (scope.status) {
      case 'loading':
        this.store.update((state) => { state.status = 'loading'; state.error = null })
        return
      case 'unavailable':
        this.store.update((state) => {
          if (this.localAcknowledged) {
            state.status = 'ready'
            state.acknowledged = true
            state.error = null
            return
          }
          state.status = 'error'
          state.acknowledged = false
          state.error = 'welcome acknowledgement settings are unavailable'
        })
        return
      case 'ready': {
        const hostAcknowledged = scope.value?.[WELCOME_NOTICE_ACK_FIELD] === WELCOME_NOTICE_VERSION
        this.store.update((state) => {
          state.status = 'ready'
          state.acknowledged = hostAcknowledged || this.localAcknowledged
          state.error = null
        })
        return
      }
      /* v8 ignore next -- every current settings scope status is handled above */
      default: return assertNever(scope.status)
    }
  }
}

/** Pause for the given number of milliseconds (settles, never rejects). */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
