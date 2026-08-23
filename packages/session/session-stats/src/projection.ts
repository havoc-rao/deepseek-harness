/**
 * The `sessionStats` projection unit: a pure fold of step boundaries, stream
 * chunks, tool pairs, and assembled assistant messages into whole-log counts
 * and wall times.
 *
 * `step/end` — not `assistant/message` — is the counted step event because it
 * is the step lifecycle authority: the loop appends exactly one per entered
 * step, in a `finally`, so completed, failed, cancelled, and max-tokens steps
 * all land one. Counting assembled assistant messages instead would overcount
 * max-tokens usage-host messages (empty content, excluded from the surface)
 * and undercount cancelled steps (aborted before the message assembles).
 *
 * The wall-time folds mirror the client window fold field by field
 * (`deriveStats` in dsh-client-ui-conversation, that fold's whole-window
 * fallback role): model time is `step/start` → `assistant/message`, first
 * token is the first non-empty delta chunk and survives an in-step
 * `llm/retry`, decode spans first token → assembled message on steps that
 * also report output tokens, and tool time pairs `tool/call` → `tool/result`
 * by callId. A cancelled step assembles no message, so its partial stream
 * time stays uncounted in every time figure — matching the window, which
 * renders it as an untimed interrupted node.
 *
 * @module @deepseek-ai/dsh-session-stats/projection
 */

import { z } from 'zod'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Accumulated whole-log figures (the view is exactly these totals). */
interface SessionStatsTotals {
  /** Distinct turns with at least one closed step so far. */
  turns: number
  /** Closed steps so far. */
  steps: number
  /** Summed model wall time over message-assembling steps, ms. */
  llmMs: number
  /** Summed matched tool call→result wall time, ms. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time over usage-reporting steps, ms. */
  decodeMs: number
  /** Summed provider output tokens over the same steps. */
  decodeTokens: number
  /** Distinct changed-file paths from successful mutation-result diffs so far. */
  filesChanged: number
  /** Summed added lines across those diffs. */
  addedLines: number
  /** Summed removed lines across those diffs. */
  removedLines: number
}

/**
 * Fold state: the totals plus the in-flight boundaries they accrue from.
 * Turn numbers are host-assigned and monotonic per session, so a single
 * `lastTurn` slot decides "first closed step of a new turn"; the state is
 * plain JSON per the unit contract (persisted-cache precondition).
 */
interface SessionStatsState extends SessionStatsTotals {
  /** Turn of the last counted `step/end`; null before the first. */
  lastTurn: number | null
  /** The open step's boundary facts; null outside a step or after its message assembled. */
  openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null
  /** Dispatch times of tool calls whose result has not landed, by callId. */
  pendingCalls: Record<string, number>
  /** Changed-file paths in first-seen order (the distinct-count source). */
  changedPaths: string[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionStats: SessionStatsState
  }
}

const sessionStatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
}).strict()

/**
 * The fold state's shape (totals plus in-flight boundaries), validated on
 * persisted-cache rows after their `ver` gate — the unit's input boundary.
 * The view is a strict subset of the state, so this schema extends
 * `sessionStatsSchema` (the wire output boundary) with the boundary fields.
 */
const sessionStatsStateSchema = sessionStatsSchema.extend({
  lastTurn: z.number().int().nonnegative().nullable(),
  openStep: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
    firstTokenTime: z.number().nonnegative().nullable(),
  }).nullable(),
  pendingCalls: z.record(z.string(), z.number().nonnegative()),
  changedPaths: z.array(z.string()),
})

/**
 * Provider-reported completion tokens, guarded the way the window fold guards
 * node usage.
 * @param usage - the assistant/message event's optional usage record.
 * @returns the output-token count, or null when unreported or invalid.
 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * One applied file change, narrowed from opaque result `meta`. The producing
 * tool owns the meta shape (write/edit attach `{ diffs }`), so the fold reads
 * it defensively at the log boundary like the diff-card models do; malformed
 * metadata counts nothing rather than throwing during replay.
 */
interface AppliedDiff {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

/**
 * Narrow a `tool/result` event's opaque `meta` to its applied file diffs.
 * @param meta - the event's `meta` field, unverified.
 * @returns the well-formed non-empty hunks, or undefined when absent or unusable.
 */
function appliedDiffs(meta: unknown): AppliedDiff[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return undefined
  const out: AppliedDiff[] = []
  for (const diff of diffs) {
    if (typeof diff !== 'object' || diff === null) return undefined
    const { path, oldText, newText } = diff as Record<string, unknown>
    if (typeof path !== 'string') return undefined
    if (oldText !== null && typeof oldText !== 'string') return undefined
    if (typeof newText !== 'string') return undefined
    out.push({ path, oldText, newText })
  }
  return out
}

/**
 * Content lines of one diff side under the diff cards' terminator rule: empty
 * text is zero lines, a single trailing newline terminates, an interior blank
 * line counts. The cumulative figures stay consistent with every per-call
 * `+A -R` card by using its exact line rule.
 * @param text - the removed or added side's text.
 * @returns the content-line count.
 */
function contentLineCount(text: string): number {
  if (text === '') return 0
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n').length
}

/**
 * Fold one successful result's applied diffs into the change totals: distinct
 * paths in first-seen order (one entry per path across the whole log) and
 * summed added/removed lines under the cards' terminator rule.
 * @param state - the totals to extend (same reference when nothing applies).
 * @param diffs - the validated hunks off the result `meta`.
 * @returns the next totals.
 */
function foldAppliedDiffs(state: SessionStatsState, diffs: AppliedDiff[]): SessionStatsState {
  const changedPaths = state.changedPaths
  let nextPaths = changedPaths
  let addedLines = state.addedLines
  let removedLines = state.removedLines
  for (const diff of diffs) {
    if (!nextPaths.includes(diff.path)) {
      if (nextPaths === changedPaths) nextPaths = [...changedPaths]
      nextPaths.push(diff.path)
    }
    addedLines += contentLineCount(diff.newText)
    if (diff.oldText !== null) removedLines += contentLineCount(diff.oldText)
  }
  if (nextPaths === changedPaths && addedLines === state.addedLines && removedLines === state.removedLines) {
    return state
  }
  return { ...state, changedPaths: nextPaths, filesChanged: nextPaths.length, addedLines, removedLines }
}

/** The `sessionStats` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const sessionStatsProjectionDefinition = {
  key: 'sessionStats',
  stateVersion: 2,
  stateSchema: sessionStatsStateSchema,
  init: () => ({
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    filesChanged: 0,
    addedLines: 0,
    removedLines: 0,
    lastTurn: null,
    openStep: null,
    pendingCalls: {},
    changedPaths: [],
  }),
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    switch (event.type) {
      case 'step/start':
        return {
          ...state,
          openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null },
        }
      case 'assistant/chunk': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        if (open.firstTokenTime !== null || !isTokenDelta(event.data.chunk)) return state
        return { ...state, openStep: { ...open, firstTokenTime: event.time } }
      }
      case 'assistant/message': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        // One assembled message per step: closing the boundary means a
        // defensive duplicate cannot accrue twice.
        const next: SessionStatsState = {
          ...state,
          llmMs: state.llmMs + Math.max(0, event.time - open.startTime),
          openStep: null,
        }
        if (open.firstTokenTime !== null) {
          next.ttftMs += Math.max(0, open.firstTokenTime - open.startTime)
          next.ttftSteps += 1
          const outputTokens = usageOutputTokens(event.data.usage)
          if (outputTokens !== null) {
            next.decodeMs += Math.max(0, event.time - open.firstTokenTime)
            next.decodeTokens += outputTokens
          }
        }
        return next
      }
      case 'tool/call':
        return { ...state, pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.time } }
      case 'tool/result': {
        // Own-key check: callId is provider-minted (model/tool JSON boundary),
        // so a prototype property name ('constructor', 'toString') on a result
        // with no recorded call must read as unmatched, not as an inherited
        // function that would poison toolMs with NaN.
        const callId = event.data.message.source.callId
        const dispatched = Object.hasOwn(state.pendingCalls, callId) ? state.pendingCalls[callId] : undefined
        if (dispatched === undefined) return state
        const pendingCalls = Object.fromEntries(
          Object.entries(state.pendingCalls).filter(([id]) => id !== callId),
        )
        const next: SessionStatsState = { ...state, toolMs: state.toolMs + Math.max(0, event.time - dispatched), pendingCalls }
        // The change totals fold only successful results that carry applied
        // diffs in their opaque `meta` (the producing tool's shape); failed
        // calls and tools that attach no diff contribute nothing, so a read,
        // a terminal, or an error never moves the figures.
        const [result] = event.data.message.content
        if (result.isError === true) return next
        const diffs = appliedDiffs(event.data.meta)
        return diffs === undefined ? next : foldAppliedDiffs(next, diffs)
      }
      case 'step/end':
        return {
          ...state,
          turns: state.lastTurn === event.data.turn ? state.turns : state.turns + 1,
          steps: state.steps + 1,
          lastTurn: event.data.turn,
          openStep: null,
        }
      case 'turn/end':
        // A call whose result never landed belongs to a cancelled or failed
        // turn; results always land within their turn, so drop the leftovers
        // instead of growing persisted state forever.
        return Object.keys(state.pendingCalls).length === 0 ? state : { ...state, pendingCalls: {} }
      default:
        return state
    }
  },
  wire: {
    viewSchema: sessionStatsSchema,
    view: state => ({
      turns: state.turns,
      steps: state.steps,
      llmMs: state.llmMs,
      toolMs: state.toolMs,
      ttftMs: state.ttftMs,
      ttftSteps: state.ttftSteps,
      decodeMs: state.decodeMs,
      decodeTokens: state.decodeTokens,
      filesChanged: state.filesChanged,
      addedLines: state.addedLines,
      removedLines: state.removedLines,
    }),
  },
} satisfies ProjectionDefinition<'sessionStats', SessionStatsState>
