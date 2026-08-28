/** Paper-tone row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createPaperRowStore } from '../src/client/settings-store.ts'

describe('createPaperRowStore', () => {
  it('init shape: default tone with revision at -1', () => {
    const store = createPaperRowStore().create()
    expect(store.getSnapshot()).toEqual({ paper: 'default', revision: -1 })
  })

  it('sync mirrors the tone and advances the revision', () => {
    const store = createPaperRowStore().create()
    store.actions.sync('sepia', 0)
    expect(store.getSnapshot()).toEqual({ paper: 'sepia', revision: 0 })
    store.actions.sync('cream', 2)
    expect(store.getSnapshot().paper).toBe('cream')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createPaperRowStore().create()
    store.actions.sync('sepia', 3)
    store.actions.sync('green', 2)
    store.actions.sync('green', 3)
    expect(store.getSnapshot().paper).toBe('sepia')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
