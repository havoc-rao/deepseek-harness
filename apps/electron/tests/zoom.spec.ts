/**
 * Unit tests for the desktop zoom chord decision (apps/electron/src/zoom.ts).
 * Pins the chord table: platform modifier (Cmd on macOS, Ctrl elsewhere),
 * code-based keys, auto-repeat and alt exclusions, and the clamped level step.
 */
import { describe, expect, it } from 'vitest'
import {
  nextZoomLevel, ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN, zoomStepFor, type ZoomChordInput,
} from '../src/zoom.ts'

/** One intercepted key press. */
function press(partial: Partial<ZoomChordInput>): ZoomChordInput {
  return { type: 'keyDown', isAutoRepeat: false, meta: false, control: false, alt: false, shift: false, code: '', ...partial }
}

describe('zoomStepFor', () => {
  it('zooms in on the platform modifier with = / + on macOS', () => {
    expect(zoomStepFor(press({ code: 'Equal', meta: true }), 'darwin')).toBe(1)
    expect(zoomStepFor(press({ code: 'Equal', meta: true, shift: true }), 'darwin')).toBe(1)
  })

  it('zooms out on the platform modifier with -', () => {
    expect(zoomStepFor(press({ code: 'Minus', meta: true }), 'darwin')).toBe(-1)
    expect(zoomStepFor(press({ code: 'Minus', control: true }), 'win32')).toBe(-1)
    expect(zoomStepFor(press({ code: 'Minus', control: true }), 'linux')).toBe(-1)
  })

  it('resets with the platform modifier + 0, without shift', () => {
    expect(zoomStepFor(press({ code: 'Digit0', meta: true }), 'darwin')).toBe(0)
    expect(zoomStepFor(press({ code: 'Digit0', control: true }), 'win32')).toBe(0)
    expect(zoomStepFor(press({ code: 'Digit0', meta: true, shift: true }), 'darwin')).toBeNull()
  })

  it('needs the platform modifier and rejects the other one', () => {
    expect(zoomStepFor(press({ code: 'Equal', control: true }), 'darwin')).toBeNull()
    expect(zoomStepFor(press({ code: 'Equal', meta: true, control: true }), 'darwin')).toBeNull()
    expect(zoomStepFor(press({ code: 'Equal', meta: true }), 'win32')).toBeNull()
    expect(zoomStepFor(press({ code: 'Equal' }), 'darwin')).toBeNull()
    expect(zoomStepFor(press({ code: 'Equal', control: true, meta: true }), 'win32')).toBeNull()
  })

  it('ignores keys outside the zoom chords', () => {
    expect(zoomStepFor(press({ code: 'Digit1', meta: true }), 'darwin')).toBeNull()
    expect(zoomStepFor(press({ code: 'KeyW', meta: true }), 'darwin')).toBeNull()
  })

  it('ignores alt-modified, auto-repeating, and non-keyDown inputs', () => {
    expect(zoomStepFor(press({ code: 'Equal', meta: true, alt: true }), 'darwin')).toBeNull()
    expect(zoomStepFor(press({ code: 'Equal', meta: true, isAutoRepeat: true }), 'darwin')).toBeNull()
    expect(zoomStepFor({ ...press({ code: 'Equal', meta: true }), type: 'keyUp' }, 'darwin')).toBeNull()
  })
})

describe('nextZoomLevel', () => {
  it('steps by the role-equivalent level per zoom direction', () => {
    expect(nextZoomLevel(0, 1)).toBe(0.5)
    expect(nextZoomLevel(0.5, -1)).toBe(0)
    expect(nextZoomLevel(1, -1)).toBe(0.5)
  })

  it('clamps to the supported range', () => {
    expect(nextZoomLevel(ZOOM_LEVEL_MAX, 1)).toBe(ZOOM_LEVEL_MAX)
    expect(nextZoomLevel(ZOOM_LEVEL_MIN, -1)).toBe(ZOOM_LEVEL_MIN)
  })

  it('always resets to level 0', () => {
    expect(nextZoomLevel(3, 0)).toBe(0)
    expect(nextZoomLevel(ZOOM_LEVEL_MIN, 0)).toBe(0)
  })
})
