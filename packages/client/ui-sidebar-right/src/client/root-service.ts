/** Session-independent right Sidebar selection; Session stores remain private. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Public control for explicitly selected root Sidebar contributions. */
export interface ISidebarRightRoot {
  /** Selected slot key, or undefined while the native Session Sidebar owns the column. */
  readonly active: ObservableSnapshot<string | undefined>
  /**
   * Register a key for this plugin lifetime. Duplicate keys throw.
   * @param key - the matching rightbar.root slot registration key.
   * @returns disposer that closes this contribution if selected.
   */
  register(key: string): () => void
  /**
   * Select and expand a registered contribution without selecting a Session. Unknown keys throw.
   * @param key - registered rightbar.root key.
   */
  open(key: string): void
  /**
   * Return the column to the native Session Sidebar only if this key is selected.
   * @param key - contribution being closed; stale callbacks do nothing.
   */
  close(key: string): void
}

/** Root contribution registry and window-local selection. */
export class SidebarRightRootController implements ISidebarRightRoot {
  readonly active = createSnapshotStore<string | undefined>(undefined)
  private readonly keys = new Map<string, object>()

  /** @param releaseLayout - release the root contribution's frame track when closing. */
  constructor(private readonly releaseLayout: () => void) {}

  register(key: string): () => void {
    if (this.keys.has(key)) throw new Error(`sidebarRightRoot: duplicate key ${key}`)
    const token = {}
    this.keys.set(key, token)
    return () => {
      if (this.keys.get(key) !== token) return
      this.keys.delete(key)
      this.close(key)
    }
  }

  open(key: string): void {
    if (!this.keys.has(key)) throw new Error(`sidebarRightRoot: unregistered key ${key}`)
    if (this.active.getSnapshot() !== key) this.active.set(key)
  }

  close(key: string): void {
    if (this.active.getSnapshot() !== key) return
    this.releaseLayout()
    this.active.set(undefined)
  }
}
