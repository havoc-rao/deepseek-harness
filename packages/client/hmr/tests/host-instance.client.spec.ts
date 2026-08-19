/**
 * Host-restart handshake decisions, pure-function level: baseline record on
 * the first connect, reload on a changed instance, ignore on repeats and on
 * legacy hosts that carry no instance id.
 */
import { describe, expect, it } from 'vitest'
import { hostInstanceAction } from '../src/client/host-instance.ts'

describe('hostInstanceAction', () => {
  it('records the first connect after page boot as the baseline', () => {
    expect(hostInstanceAction(undefined, 'host-a')).toBe('record')
  })

  it('ignores repeated frames from the same host instance', () => {
    expect(hostInstanceAction('host-a', 'host-a')).toBe('ignore')
  })

  it('reloads when the instance changed — the host restarted under a live tab', () => {
    expect(hostInstanceAction('host-a', 'host-b')).toBe('reload')
  })

  it('ignores a legacy host that carries no instance id', () => {
    expect(hostInstanceAction(undefined, undefined)).toBe('ignore')
    expect(hostInstanceAction('host-a', undefined)).toBe('ignore')
  })
})
