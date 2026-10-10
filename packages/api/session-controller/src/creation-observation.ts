/** Peer-bound, bounded creation observations; no browser-supplied trace context or attributes. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Operation } from '@deepseek-ai/dsh-observability-otel'
import type {
  SessionCreationObservationReport, SessionCreationObservationToken, SessionCreationPhase,
} from './types.ts'

const extensionOwner = 'dsh-enhanced-workspace'
const controllerOwner = '@deepseek-ai/dsh-api-session-controller'
const phases: Record<SessionCreationPhase, string> = {
  'command.entryToReady': extensionOwner,
  'command.navigation': extensionOwner,
  'client.createRoundTrip': controllerOwner,
  'client.catalogProjection': controllerOwner,
  'client.retainBinding': controllerOwner,
  'client.initialOpen': controllerOwner,
  'client.rpcWait': controllerOwner,
  'client.rpcResponse': controllerOwner,
  'client.historyOpen': controllerOwner,
  'client.followBaselineDecode': controllerOwner,
  'client.projectionApply': controllerOwner,
  'client.historyApply': controllerOwner,
  'client.observationBegin': controllerOwner,
  'client.requestEncode': '@deepseek-ai/dsh-client-connection',
  'client.fetchHeaders': '@deepseek-ai/dsh-client-connection',
  'client.responseDecode': '@deepseek-ai/dsh-client-connection',
  'client.responseBodyRead': '@deepseek-ai/dsh-client-connection',
  'client.responseEnvelopeParse': '@deepseek-ai/dsh-client-connection',
  'client.responseFormData': '@deepseek-ai/dsh-client-connection',
  'client.responseBinaryRead': '@deepseek-ai/dsh-client-connection',
  'client.resultCodecDecode': '@deepseek-ai/dsh-api-gateway',
}

interface Entry {
  readonly peer: object
  readonly operation: Operation
  readonly timer: ReturnType<typeof setTimeout>
  used: boolean
  readonly anchorUnixMs: number
}

/** Owns observation capabilities independently from committed creation and navigation. */
export class CreationObservations {
  private readonly entries = new Map<SessionCreationObservationToken, Entry>()
  private closed = false

  /**
   * @param ctx - Host context with optional observation service.
   * @param capacity - Maximum pending observations.
   * @param lifetimeMs - Maximum capability lifetime, in milliseconds.
   */
  constructor(private readonly ctx: Context, private readonly capacity: number, private readonly lifetimeMs: number) {
    ctx.effect(() => () => {
      this.closed = true
      for (const entry of this.entries.values()) {
        clearTimeout(entry.timer)
        entry.operation.end('cancelled')
      }
      this.entries.clear()
    }, 'session-controller.creation-observations')
  }

  /**
   * Start only after explicit owner selection.
   * @param peer - Gateway Peer identity.
   * @returns Random token, or null when disabled or full.
   */
  begin(peer: object): SessionCreationObservationToken | null {
    const observation = this.ctx.get('observability')
    if (this.closed || !observation?.selected(extensionOwner) || this.entries.size >= this.capacity) return null
    const anchorUnixMs = Date.now()
    const operation = observation.start(extensionOwner, 'command.sessionCreation', { kind: 'client' })
    const token = brandString<SessionCreationObservationToken>(randomUUID())
    const timer = setTimeout(() => {
      this.entries.delete(token)
      operation.end('timeout')
    }, this.lifetimeMs)
    timer.unref()
    this.entries.set(token, { peer, operation, timer, used: false, anchorUnixMs })
    return token
  }

  /**
   * Activate one admitted create call; stale, reused, or foreign tokens have no effect on creation.
   * @param token - Optional observation capability.
   * @param peer - Gateway Peer identity.
   * @param create - Unchanged creation callback.
   * @returns Original callback result and rejection.
   */
  create<T>(token: SessionCreationObservationToken | undefined, peer: object | undefined, create: () => T): T {
    const entry = token === undefined ? undefined : this.entries.get(token)
    if (entry === undefined || entry.peer !== peer || entry.used) return create()
    entry.used = true
    return entry.operation.with(create)
  }

  /**
   * Lend the command parent only to a matching unused creation capability.
   * @param token - Optional wire capability.
   * @param peer - Gateway caller identity.
   * @returns Scoped Gateway callbacks, or undefined for unobserved requests.
   */
  gateway(token: SessionCreationObservationToken | undefined, peer: object): {
    with<T>(fn: () => T): T
    run<T>(phase: 'gateway.prepare' | 'gateway.dispatch' | 'gateway.resultEncode', fn: () => T): T
  } | undefined {
    const entry = token === undefined ? undefined : this.entries.get(token)
    if (entry === undefined || entry.peer !== peer || entry.used) return undefined
    return {
      with: fn => entry.operation.with(fn),
      run: (phase, fn) => {
        const observation = this.ctx.get('observability')
        return observation === undefined ? fn()
          : observation.run('@deepseek-ai/dsh-api-gateway', phase, fn)
      },
    }
  }

  /**
   * Observe Host response delivery only for this request's admitted command token.
   * @param token - Wire capability inspected without exporting its value.
   * @param peer - Authenticated request caller.
   * @returns Recorder whose stable stages nest under the command, or undefined.
   */
  response(token: SessionCreationObservationToken | undefined, peer: object): ((
    phase: 'host.responseFrame' | 'host.responseWrite' | 'host.responseFinish',
    start: number, end: number, outcome: 'success' | 'error' | 'cancelled',
  ) => void) | undefined {
    if (token === undefined) return undefined
    const entry = this.entries.get(token)
    if (entry === undefined || entry.peer !== peer || entry.used) return undefined
    return (phase, start, end, outcome) => {
      if (this.closed || this.entries.get(token) !== entry) return
      entry.operation.with(() => this.ctx.get('observability')?.recordInterval(
        '@deepseek-ai/dsh-client-connection', phase, start, end, outcome))
    }
  }

  /**
   * Consume a report once, with all durations checked before recording any phase.
   * @param report - Reviewed phase names and bounded monotonic durations.
   * @param peer - Gateway Peer identity.
   */
  finish(report: SessionCreationObservationReport, peer: object): void {
    const entry = this.entries.get(report.token)
    if (entry === undefined || entry.peer !== peer) return
    this.entries.delete(report.token)
    clearTimeout(entry.timer)
    const outcomes = ['success', 'error', 'cancelled', 'timeout']
    const items = 'timeline' in report ? report.timeline : report.phases
    const valid = outcomes.includes(report.outcome)
      && items.length <= Object.keys(phases).length
      && new Set(items.map(item => item.phase)).size === items.length
      && items.every(item => Object.hasOwn(phases, item.phase))
      && ('timeline' in report
        ? report.timeline.every(item => outcomes.includes(item.outcome)
          && Number.isFinite(item.startOffsetMs) && Number.isFinite(item.endOffsetMs)
          && item.startOffsetMs >= (item.phase === 'client.observationBegin' || item.phase === 'command.entryToReady'
            ? -this.lifetimeMs : 0)
          && item.endOffsetMs >= item.startOffsetMs && item.endOffsetMs <= this.lifetimeMs
          && item.endOffsetMs - item.startOffsetMs <= this.lifetimeMs)
          && report.timeline.every((item) => {
            if (!['client.responseBodyRead', 'client.responseEnvelopeParse', 'client.responseFormData',
              'client.responseBinaryRead'].includes(item.phase)) return true
            const parent = report.timeline.find(value => value.phase === 'client.responseDecode')
            return parent === undefined || (item.startOffsetMs >= parent.startOffsetMs && item.endOffsetMs <= parent.endOffsetMs)
          })
        : report.phases.every(item => Number.isFinite(item.durationMs) && item.durationMs >= 0 && item.durationMs <= this.lifetimeMs))
    if (valid) entry.operation.with(() => {
      const observation = this.ctx.get('observability')
      if ('timeline' in report) {
        const response = report.timeline.find(item => item.phase === 'client.responseDecode')
        const responseChildren = new Set<SessionCreationPhase>(['client.responseBodyRead', 'client.responseEnvelopeParse',
          'client.responseFormData', 'client.responseBinaryRead'])
        const emit = (item: (typeof report.timeline)[number], children?: () => void) => observation?.recordInterval(
          phases[item.phase], item.phase, entry.anchorUnixMs + item.startOffsetMs,
          entry.anchorUnixMs + item.endOffsetMs, item.outcome, children)
        for (const item of report.timeline) {
          if (response !== undefined && responseChildren.has(item.phase)) continue
          if (item === response) emit(item, () => {
            for (const child of report.timeline) if (responseChildren.has(child.phase)) emit(child)
          })
          else emit(item)
        }
      } else {
        for (const item of report.phases) observation?.recordDuration(phases[item.phase], item.phase, item.durationMs, report.outcome)
      }
    })
    entry.operation.end(valid ? report.outcome : 'error')
  }
}
