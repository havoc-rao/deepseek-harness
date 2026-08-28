/** Appearance row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference, default paper, revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', paper: 'default', revision: -1 })
  })

  it('sync mirrors the preference and paper and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'default', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', paper: 'default', revision: 0 })
    store.actions.sync('light', 'sepia', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().paper).toBe('sepia')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'cream', 3)
    store.actions.sync('system', 'sepia', 2)
    store.actions.sync('system', 'cream', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().paper).toBe('cream')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
