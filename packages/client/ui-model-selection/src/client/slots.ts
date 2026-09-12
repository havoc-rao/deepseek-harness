/**
 * ModelSelect's injected face and the label child-slot contract. The target
 * 'conversation.input.model' seat is declared (children table) and typed by
 * ui-conversation's composer-bar entry; this package contributes the single
 * occupant and declares its own label child slot (`conversation.input.model.label`)
 * here, following the SlotMap-declaration style of ui-chat's contract.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

/** Owner currency of the ModelSelect trigger label child slot. */
export interface ModelTriggerOwnerProps {
  /** Display name of the current model (catalog model.name). */
  modelName: string
  /** Display name of the provider group (group.name). */
  providerName: string
  /** Wire model id (model.id). */
  modelId: string
  /** Provider-group id (group.id). */
  providerId: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Replacement renderer for the visible label segment of the ModelSelect
     * trigger's `conversation.input.model` occupant. The owner carries the
     * current catalog route; with no occupant the shipped model label stays
     * unchanged.
     */
    'conversation.input.model.label': {
      kind: 'single'
      scope: 'session'
      owner: ModelTriggerOwnerProps
    }
  }
}

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** The session's shared directory store (same instance the /model popup reads). */
  directory: SnapshotStore<ModelDirectoryState>
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns whether the host accepted the selection.
   */
  select: (selection: ModelSelection) => Promise<boolean>
}
