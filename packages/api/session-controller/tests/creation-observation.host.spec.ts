/** Observation capabilities isolate Peers, preserve creation, and reject unsafe reports. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CreationObservations } from '../src/creation-observation.ts'
import type { SessionCreationObservationReport } from '../src/types.ts'

function fixture(selected = true) {
  const ctx = new Context()
  const end = vi.fn()
  const withContext = vi.fn(<T>(fn: () => T): T => fn())
  const recordDuration = vi.fn()
  const recordInterval = vi.fn<(owner: string, operation: string, start: number, end: number,
    outcome: import('../src/types.ts').SessionCreationOutcome, children?: () => void) => void>()
  ctx.provide('observability', { selected: () => selected,
    start: () => ({ with: withContext, end }), recordDuration, recordInterval,
  } as never)
  const observations = new CreationObservations(ctx, 1, 60000)
  return { ctx, end, withContext, recordDuration, recordInterval, observations }
}

describe('creation observation capability', () => {
  it('disabled and missing runtimes allocate no capability and leave callback results unchanged', async () => {
    const disabled = fixture(false)
    const ctx = new Context()
    try {
      expect(disabled.observations.begin({})).toBeNull()
      expect(new CreationObservations(ctx, 1, 60000).begin({})).toBeNull()
      const result = Promise.resolve('unchanged')
      expect(disabled.observations.create(undefined, undefined, () => result)).toBe(result)
    } finally { await Promise.all([ctx.fiber.dispose(), disabled.ctx.fiber.dispose()]) }
  })

  it('links one create to its Peer and records only reviewed owner/phase values once', async () => {
    const f = fixture()
    const peer = {}
    try {
      const token = f.observations.begin(peer)!
      expect(f.observations.begin(peer)).toBeNull()
      expect(f.observations.create(token, {}, () => 4)).toBe(4)
      expect(f.withContext).not.toHaveBeenCalled()
      const error = new Error('private error/path/session/workspace')
      expect(() => f.observations.create(token, peer, () => { throw error })).toThrow(error)
      expect(f.withContext).toHaveBeenCalledOnce()
      f.observations.create(token, peer, () => 5)
      expect(f.withContext).toHaveBeenCalledOnce()
      const report: SessionCreationObservationReport = { token, outcome: 'success', phases: [
        { phase: 'command.entryToReady', durationMs: 25 },
        { phase: 'client.catalogProjection', durationMs: 1 },
      ] }
      f.observations.finish(report, {})
      expect(f.recordDuration).not.toHaveBeenCalled()
      f.observations.finish(report, peer)
      f.observations.finish(report, peer)
      expect(f.recordDuration.mock.calls).toEqual([
        ['dsh-enhanced-workspace', 'command.entryToReady', 25, 'success'],
        ['@deepseek-ai/dsh-api-session-controller', 'client.catalogProjection', 1, 'success'],
      ])
      expect(f.end).toHaveBeenCalledExactlyOnceWith('success')
    } finally { await f.ctx.fiber.dispose() }
  })

  it.each([NaN, Infinity, -1, 60001])('drops the complete invalid duration report (%s)', async (durationMs) => {
    const f = fixture()
    const peer = {}
    try {
      const token = f.observations.begin(peer)!
      f.observations.finish({ token, outcome: 'error', phases: [
        { phase: 'client.initialOpen', durationMs },
      ] }, peer)
      expect(f.recordDuration).not.toHaveBeenCalled()
      expect(f.end).toHaveBeenCalledExactlyOnceWith('error')
    } finally { await f.ctx.fiber.dispose() }
  })

  it('anchors relative timelines at begin issuance with independent phase outcomes', async () => {
    const f = fixture()
    const peer = {}
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    try {
      const token = f.observations.begin(peer)!
      clock.mockReturnValue(1700000009000)
      f.observations.finish({ token, outcome: 'error', timeline: [
        { phase: 'client.rpcWait', startOffsetMs: 10, endOffsetMs: 30, outcome: 'success' },
        { phase: 'client.historyOpen', startOffsetMs: 30, endOffsetMs: 70, outcome: 'timeout' },
      ] }, peer)
      expect(f.recordInterval.mock.calls.map(call => call.slice(0, 5))).toEqual([
        ['@deepseek-ai/dsh-api-session-controller', 'client.rpcWait', 1700000000010, 1700000000030, 'success'],
        ['@deepseek-ai/dsh-api-session-controller', 'client.historyOpen', 1700000000030, 1700000000070, 'timeout'],
      ])
      expect(f.recordDuration).not.toHaveBeenCalled()
      expect(f.end).toHaveBeenCalledExactlyOnceWith('error')
    } finally { clock.mockRestore(); await f.ctx.fiber.dispose() }
  })

  it('accepts response subphase intervals only with fixed carrier and Gateway owners', async () => {
    const f = fixture()
    const peer = {}
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    try {
      const token = f.observations.begin(peer)!
      f.observations.finish({ token, outcome: 'error', timeline: [
        { phase: 'client.responseBodyRead', startOffsetMs: 10, endOffsetMs: 20, outcome: 'success' },
        { phase: 'client.responseEnvelopeParse', startOffsetMs: 20, endOffsetMs: 25, outcome: 'error' },
        { phase: 'client.responseFormData', startOffsetMs: 25, endOffsetMs: 40, outcome: 'success' },
        { phase: 'client.responseBinaryRead', startOffsetMs: 40, endOffsetMs: 50, outcome: 'cancelled' },
        { phase: 'client.resultCodecDecode', startOffsetMs: 50, endOffsetMs: 60, outcome: 'error' },
      ] }, peer)
      expect(f.recordInterval.mock.calls.map(call => call.slice(0, 5))).toEqual([
        ['@deepseek-ai/dsh-client-connection', 'client.responseBodyRead', 1700000000010, 1700000000020, 'success'],
        ['@deepseek-ai/dsh-client-connection', 'client.responseEnvelopeParse', 1700000000020, 1700000000025, 'error'],
        ['@deepseek-ai/dsh-client-connection', 'client.responseFormData', 1700000000025, 1700000000040, 'success'],
        ['@deepseek-ai/dsh-client-connection', 'client.responseBinaryRead', 1700000000040, 1700000000050, 'cancelled'],
        ['@deepseek-ai/dsh-api-gateway', 'client.resultCodecDecode', 1700000000050, 1700000000060, 'error'],
      ])
      expect(f.end).toHaveBeenCalledExactlyOnceWith('error')
    } finally { clock.mockRestore(); await f.ctx.fiber.dispose() }
  })

  it('rejects a response child whose interval escapes its inclusive parent', async () => {
    const f = fixture()
    const peer = {}
    try {
      const token = f.observations.begin(peer)!
      f.observations.finish({ token, outcome: 'success', timeline: [
        { phase: 'client.responseDecode', startOffsetMs: 10, endOffsetMs: 20, outcome: 'success' },
        { phase: 'client.responseBodyRead', startOffsetMs: 5, endOffsetMs: 15, outcome: 'success' },
      ] }, peer)
      expect(f.recordInterval).not.toHaveBeenCalled()
      expect(f.end).toHaveBeenCalledExactlyOnceWith('error')
    } finally { await f.ctx.fiber.dispose() }
  })

  it('accepts bounded negative offsets only for begin and complete command intervals', async () => {
    const f = fixture()
    const peer = {}
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    try {
      const token = f.observations.begin(peer)!
      f.observations.finish({ token, outcome: 'timeout', timeline: [
        { phase: 'client.observationBegin', startOffsetMs: -25, endOffsetMs: 0, outcome: 'success' },
        { phase: 'command.entryToReady', startOffsetMs: -40, endOffsetMs: 80, outcome: 'timeout' },
      ] }, peer)
      expect(f.recordInterval.mock.calls.map(call => call.slice(0, 5))).toEqual([
        ['@deepseek-ai/dsh-api-session-controller', 'client.observationBegin', 1699999999975, 1700000000000, 'success'],
        ['dsh-enhanced-workspace', 'command.entryToReady', 1699999999960, 1700000000080, 'timeout'],
      ])
      expect(f.end).toHaveBeenCalledExactlyOnceWith('timeout')
    } finally { clock.mockRestore(); await f.ctx.fiber.dispose() }
  })

  it.each(['client.observationBegin', 'command.entryToReady'] as const)(
    'rejects the complete %s report outside the signed lifetime width', async (phase) => {
      const f = fixture()
      const peer = {}
      try {
        const token = f.observations.begin(peer)!
        f.observations.finish({ token, outcome: 'success', timeline: [
          { phase, startOffsetMs: -60001, endOffsetMs: 0, outcome: 'success' },
        ] }, peer)
        expect(f.recordInterval).not.toHaveBeenCalled()
        expect(f.end).toHaveBeenCalledExactlyOnceWith('error')
      } finally { await f.ctx.fiber.dispose() }
    },
  )

  it.each([[-1, 1], [20, 10], [0, 60001], [NaN, 1], [0, Infinity]])(
    'drops invalid timeline endpoints %s/%s', async (startOffsetMs, endOffsetMs) => {
      const f = fixture()
      const peer = {}
      try {
        const token = f.observations.begin(peer)!
        f.observations.finish({ token, outcome: 'success', timeline: [
          { phase: 'client.rpcWait', startOffsetMs, endOffsetMs, outcome: 'success' },
        ] }, peer)
        expect(f.recordInterval).not.toHaveBeenCalled()
        expect(f.end).toHaveBeenCalledExactlyOnceWith('error')
      } finally { await f.ctx.fiber.dispose() }
    },
  )

  it('expires observation without cancelling or changing admitted creation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const peer = {}
    try {
      const token = f.observations.begin(peer)!
      const work = Promise.withResolvers<string>()
      const created = f.observations.create(token, peer, () => work.promise)
      await vi.advanceTimersByTimeAsync(60000)
      expect(f.end).toHaveBeenCalledExactlyOnceWith('timeout')
      work.resolve('committed')
      await expect(created).resolves.toBe('committed')
      f.observations.finish({ token, outcome: 'success', phases: [] }, peer)
      expect(f.end).toHaveBeenCalledOnce()
    } finally {
      await f.ctx.fiber.dispose()
      vi.useRealTimers()
    }
  })

  it('rejects duplicate phases and cancels pending observations on disposal', async () => {
    const f = fixture()
    const peer = {}
    const token = f.observations.begin(peer)!
    f.observations.finish({ token, outcome: 'success', phases: [
      { phase: 'client.initialOpen', durationMs: 1 },
      { phase: 'client.initialOpen', durationMs: 2 },
    ] }, peer)
    expect(f.recordDuration).not.toHaveBeenCalled()
    f.observations.begin(peer)
    await f.ctx.fiber.dispose()
    expect(f.end.mock.calls).toEqual([['error'], ['cancelled']])
    expect(f.observations.begin(peer)).toBeNull()
  })
})
