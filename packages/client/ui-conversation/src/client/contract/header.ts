/** Committed main Conversation header state for cross-plugin entry placement. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationPhase } from './snapshot.ts'

/** Presentation facts, not button presence, geometry, or occlusion. */
export interface ConversationHeaderSnapshot {
  /** Selected Session; undefined while the resident header has no Session. */
  readonly sessionId: SessionId | undefined
  /** Shell phase; undefined until both Session and Conversation sources exist. */
  readonly phase: ConversationPhase | undefined
  /** Whether the title, actions, and utilities are rendered. */
  readonly chromeVisible: boolean
  /** Whether the strict Session header offers its corner slot, including blank Sessions. */
  readonly cornerAvailable: boolean
}

/** Private registration callback used by the header after React commits. */
export interface ConversationHeaderInjected {
  /**
   * Publish committed presentation or clear it on unmount.
   * @param snapshot - current header facts; undefined when its owner unmounts.
   */
  readonly reportHeader: (snapshot: ConversationHeaderSnapshot | undefined) => void
}
