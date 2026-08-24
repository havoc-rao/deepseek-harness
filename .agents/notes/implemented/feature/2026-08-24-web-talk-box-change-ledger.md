# Agent Note: every talk box records the session's cumulative file changes

Status: implemented

English | [中文](2026-08-24-web-talk-box-change-ledger.zh.md)

> Scope: a per-talk-box ledger of the session's cumulative file changes — distinct changed files plus added/removed line totals — rendered under the produced-files row, folded from the durable log. Not in scope: real `git diff` figures (the host never runs git for presentation), and per-hunk or per-turn line breakdowns.

## Problem

The diff cards show each write/edit call's `+A -R`, but nothing answered "how much has the session changed so far" at a glance. The produced-files row lists one turn's output; the cumulative picture had to be reconstructed by reading every card. A whole-log figure also cannot be computed from the visible window: the chat window is paged and compaction rewrites it, so a client-side fold over what is on screen changes with paging.

## Decision

**The `sessionStats` projection gains three change fields folded from the durable log.** `filesChanged`, `addedLines`, and `removedLines` accrue over every successful `tool/result` whose opaque `meta` carries applied file diffs — the shape the write/edit tools attach. Distinct paths count once across the whole log; lines sum under the same terminator rule the web diff cards use (empty text is zero lines, a trailing newline terminates, an interior blank line counts), so the ledger agrees with every per-call card. Failed results and results without diffs contribute nothing, and the fold narrows the opaque `meta` defensively like the diff-card models do. The projection is the sanctioned whole-log home (same paging/compaction guarantee as the stats strip), so the figures survive both.

**Write creates now record their applied diff in `meta`.** The write tool's `presentationMeta` emitted `{ diffs: [] }` for a create, so replay fell back to an args-derived whole-file diff while the persisted meta described no change. The meta is now the diff the card shows (`oldText: null`, whole new content), which makes the projection count creates — and makes the persisted meta self-describing. The visible card is unchanged.

**The produced-files row is the talk box's file-domain ledger.** `ProducedFiles` renders one measured chip lane per side — **Produced** (the turn's write/edit files) above **Read** (the turn's read files), each lane shown only when its side has paths — with the cumulative totals (`useProjection('sessionStats')`) below; its chain selector (`selectTurnFiles`) claims every turn (not only producing ones), and the component returns null when there is neither a produced chip, a read chip, nor any session change — a turn that only read still records its read lane and the running total, and a session with no changes shows nothing. A composition without the session-stats unit serves no projection value and the totals are simply absent (the chips still show). The web stats strip's window fold is not extended: without the unit, the change fields are absent rather than window-approximated.

## Alternatives considered

- **Running `git diff --stat` on the host and pushing it live** — the honest git figure, but a new live presentation channel that replay cannot recompute, tied to the workspace being a git tree and to unlogged external edits. The session-log fold is replayable by construction and answers "what the session's file tools changed", which is the claim the row already makes.
- **Client-side cumulative fold over the snapshot window** — wrong under paging and compaction; the durable projection exists precisely for whole-log facts.
- **The projection pairing `tool/call` args to count creates itself** — hardcodes tool names and replays their fallback logic inside a generic fold. Making the tools' own `meta` carry the applied diff keeps the opaque-shape contract ("the producing tool owns and narrows") intact.
- **A separate turn-tail row for the ledger** — the row already sits in the talk box's tail and shares its opener/locale machinery; one row, one claim.
- **`str_replace_editor` diffs** — it records no result `meta` today (args-derived call view only), so it stays out of the ledger rather than teaching the fold a second tool shape.

## Consequences

The `sessionStats` `stateVersion` is 4 (the ledgers now keep recency order and the wire view adds `recentInputs`/`recentOutputs` — see [the session hover note](2026-08-24-session-hover-recent-files.md)), so persisted projection caches from earlier versions are discarded and refolded. The numbers are cumulative sums, not a net diff: repeated edits of one file accumulate, and the diff cards' context lines count on both sides. `apps/web/tests/produced-files.e2e.ts` seeds write results with the real create-meta shape and pins the assembled ledger text (`Total: 10 files · +10 -0 lines`), the tool-fs create-meta test pins the new persisted shape, and the projection spec pins the fold including every malformed-meta guard.
