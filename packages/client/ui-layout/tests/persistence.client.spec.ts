// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RIGHTBAR_PREFERENCE_KEY,
  readRightbarPreference,
  writeRightbarPreference,
} from '../src/client/persistence.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('readRightbarPreference', () => {
  it('returns null when nothing is stored', () => {
    expect(readRightbarPreference()).toBeNull()
  })

  it('reads a previously written width', () => {
    localStorage.setItem(RIGHTBAR_PREFERENCE_KEY, '640')
    expect(readRightbarPreference()).toBe(640)
  })

  it.each(['', 'abc', '0', '-1', '299', '300.5'])('treats the corrupt value %j as absent', (raw) => {
    localStorage.setItem(RIGHTBAR_PREFERENCE_KEY, raw)
    expect(readRightbarPreference()).toBeNull()
  })

  it('returns null when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(readRightbarPreference()).toBeNull()
  })

  it('tolerates a missing localStorage global', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readRightbarPreference()).toBeNull()
    vi.unstubAllGlobals()
  })
})

describe('writeRightbarPreference', () => {
  it('round-trips a committed width', () => {
    writeRightbarPreference(640)
    expect(localStorage.getItem(RIGHTBAR_PREFERENCE_KEY)).toBe('640')
  })

  it('does not throw when storage fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => { writeRightbarPreference(640) }).not.toThrow()
  })

  it('tolerates a missing localStorage global', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => { writeRightbarPreference(640) }).not.toThrow()
    vi.unstubAllGlobals()
  })
})
