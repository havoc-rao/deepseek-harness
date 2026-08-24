/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. The turn/step
 * and wall-time field names mirror the client window fold so an assembly
 * without this unit can fall back to it wholesale; the change fields have no
 * window mirror (see the README's Known Limitations).
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
  /**
   * Distinct file paths across every successful mutation result in the whole
   * log whose `tool/result` `meta` carries applied file diffs (the write/edit
   * tools attach theirs). A path counts once no matter how many calls touched
   * it, matching the diff cards' distinct-file rule.
   */
  filesChanged: number
  /** Summed added lines across the same applied diffs (each `newText` side). */
  addedLines: number
  /** Summed removed lines across the same applied diffs (each non-null `oldText` side). */
  removedLines: number
  /**
   * Read-file paths in recency order — the session's input sources: most
   * recently read first, each path once, a re-read moving it back to the
   * front. The wire list carries the newest 32 paths at most. Paths come
   * from successful read results whose `tool/result` `meta` carries the
   * read tool's structured window (the shape its read card replays from);
   * tools without that meta contribute nothing.
   */
  recentInputs: string[]
  /**
   * Changed-file paths in recency order — the session's output sources: most
   * recently modified first, each path once, a re-modification moving it back
   * to the front. The wire list carries the newest 32 paths at most
   * (`filesChanged` counts the full ledger, so older paths leave
   * `recentOutputs` while staying counted). Paths are the model-facing paths
   * stamped on the applied diffs (verbatim `args.file_path`), relative or
   * absolute.
   */
  recentOutputs: string[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
