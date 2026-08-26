# Agent Note: session hover cards list the session's input/output file sources as directory trees

Status: implemented

English | [中文](2026-08-24-session-hover-recent-files.zh.md)

## Problem

The workspace browser's session hover card showed title, relative time, and status only. The durable `sessionStats` projection already folded whole-log change totals from successful mutation-result diffs (the [talk-box ledger](2026-08-24-web-talk-box-change-ledger.md)), but the ledger's path identities stayed host-internal, so a surface that asks "what file domain did this session touch" had no data without opening the session and paging its history. The file lists are exactly the whole-log fact the projection seam exists to serve: they must survive paging, compaction, and restarts, and they must render on list rows without opening the session.

## Decision

**The `sessionStats` fold keeps two distinct-path ledgers, each in recency order.** The output ledger holds every path a successful mutation diff touched (write/edit); the input ledger holds every path a successful read window returned (`recentInputs`/`recentOutputs` on the wire). A path already in its ledger moves to the front on re-use; a new path unshifts. `filesChanged` and the line totals stay the output ledger's, unchanged in semantics.

**The read signal is the read tool's persisted window meta.** Inputs are recognized from successful read results whose `tool/result` `meta` carries the read tool's structured window (`path` + `offset` + `lines`, the shape its read card replays from), narrowed defensively like the diff meta. Tools without that window — `str_replace_editor`'s `view`, `read_image`, search reads — contribute nothing, mirroring how mutation tools without diff meta contribute nothing to the output ledger.

**The wire lists carry the newest 32 paths each.** A wire bound on a hover display far above any client row cap. The fold state itself stays uncapped: the ledgers are the distinct-count oracles, so truncating them would let an evicted path recount on re-use and silently inflate the figures (the ledgers' unbounded state growth is a documented Known Limitation of the projection, not introduced here).

**The session hover card renders both sides.** ui-workspace's `SessionNode` derives `recentInputs`/`recentOutputs` from the row's `projectionValues.sessionStats` (type-only dependency on `dsh-session-stats/client`, the same merge pattern ui-deliverables uses), and `recentFileTree()` folds each list into display rows — directories before files at each level, both in arrival (recency) order, absolute roots losing their leading separator, Windows drive letters kept as a first segment. Two compaction rules keep the card short: a lone file on a side renders as one flat VSCode-style path row (no directory scaffolding), and a run of singly-nested directories merges into one row until a level holds a file of its own, so `src/client/rows/` displays as a single line. Paths inside the session working directory render relative to it — the project root prefix is dropped — and paths outside keep their full form. The card renders the input section above the output section inside one internally scrolling box (bounded height), each side defaulting to a flat `name | path` list with a toolbar toggle switching it to the merged directory tree (capped at 8 rows, the clickable `+N` remainder expanding that side into its full list); clicking a file row marks it with a background tint for observation; a side with no paths — or an unmounted projection unit — omits its section. The lists update live: session-list baselines and `session/projection` push frames already carry the key, so the hover shows the current ledgers without opening the session.

## Alternatives considered

- **A separate projection unit for the file lists** — would duplicate the applied-diff fold and its defensive `meta` narrowing; session-stats already owns that vocabulary and the change-feed plumbing.
- **Presenter-based recognition (call-view `locations`, like the produced-files chips)** — the ui-deliverables vocabulary is render-intent based, but evaluating `presentCall` inside a projection fold requires the scoped tool registry synchronously, which preset standing layers cannot provide; the persisted result `meta` is replay-faithful and registry-free. The hover, the talk-box totals, and the input ledger therefore share one vocabulary family (persisted result metas), and tools that attach no relevant `meta` contribute nothing.
- **Bounding the persisted ledgers to the wire caps** — the eviction would lose the exact-distinct oracles; the retained-and-returned path would double-count. The wire is bounded instead.
- **Deriving inputs from `tool/call` arguments by tool name** — would hardcode tool schemas inside a generic fold and replay nothing; the persisted read window is the read tool's own recorded fact.

## Consequences

The `sessionStats` `stateVersion` is 4, so persisted projection-cache rows from earlier versions are discarded and refolded on next use. The hover card's lists are presentation slices of the same ledgers the talk-box totals describe, so the surfaces cannot disagree about what counts as a change. Browsing a file-heavy session grows the projection state as before; the newest-32 wire bounds keep the delivered payload small. The session hover card overrides the shared 244px card width to 300px (the file sections need room for paths), and rows keep their full content width: long paths are reached by the file box's horizontal scrollbar, never ellipsis-clipped (the title tooltip still carries the full path).

## Testing

The projection spec pins recency reordering (a re-use moves the path to the front without recounting), the wire caps, read-window narrowing (every malformed and foreign meta shape), and unchanged totals math. ui-workspace's tree spec pins the projection mapping and every `recentFileTree` shape (ordering, roots, the single-file flat row, singleton-chain merging, budget exhaustion mid-descend and mid-sibling-loop, defensive dedupe), and the rows spec renders both hover sections and the exact remainder line. `pnpm run test:gui` is green; both changed packages hold per-file 100% coverage.