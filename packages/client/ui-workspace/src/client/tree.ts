/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import {
  indexSubagentDescendants, type PendingInteractionStatus, type SessionId, type SessionListState,
  type SessionSearchResultItem, type SessionSummary, type SubagentDescendantSummary,
  type WorkspaceId, type WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges the sessionStats key into SessionProjectionMap so the
// projection read below types against the recent-files field.
import type {} from '@deepseek-ai/dsh-session-stats/client'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/** Display label for the ungrouped bucket row. */
export const UNGROUPED_LABEL = 'Ungrouped'

/** One top-level session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  updatedAt: number
  /**
   * The session's working directory (the project root); the hover card
   * relativizes file paths under it. Absent when the header recorded none.
   */
  cwd?: string
  /**
   * Files the session read most recently, newest first — its input sources —
   * from the durable `sessionStats` projection value riding the row's
   * projection baseline (empty before any successful read or while the
   * projection unit is unmounted). The hover card renders them as a
   * directory tree under the input heading.
   */
  recentInputs: readonly string[]
  /**
   * Files the session modified most recently, newest first — its output
   * sources (write/edit mutations) — from the durable `sessionStats`
   * projection value riding the row's projection baseline (empty before any
   * successful mutation result or while the projection unit is unmounted).
   * The hover card renders them as a directory tree under the output heading.
   */
  recentOutputs: readonly string[]
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible session rows (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNGROUPED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archived
 * sessions are visible nowhere, while their accounting slots remain so
 * unarchiving restores position.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? 'New Session' : session.displayTitle
}

/** Build one group without projecting session lineage into presentation. */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
): Group {
  const sessions = [...members]
  // Real Workspace order comes from sessionIds. Ungrouped falls back to
  // recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, workspaceId, cwd, createdAt, label, sessions }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace: one group per entity in stable Host
 * order, with members resolved from sessionIds in their stored order. Sessions
 * outside every Workspace trail in the browser-local Ungrouped order, which
 * falls back to recency before that order is initialized.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder: readonly string[] | undefined,
): Group[] {
  const groups: Group[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    groups.push(buildGroup(
      workspace.workspaceId, workspace.workspaceId, workspace.path,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY,
      undefined,
      undefined,
      undefined,
      UNGROUPED_LABEL,
      ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
      ungroupedOrder === undefined ? 'recency' : 'account',
    ))
  }
  return groups
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
): SessionNode {
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: s.completed === true,
    updatedAt: s.updatedAt,
    recentInputs: s.projectionValues?.sessionStats?.recentInputs ?? [],
    recentOutputs: s.projectionValues?.sessionStats?.recentOutputs ?? [],
    ...(s.cwd === undefined ? {} : { cwd: s.cwd }),
    ...(s.pendingInteraction === undefined ? {} : { pendingInteraction: s.pendingInteraction }),
  }
}

/**
 * Derive the workspace browser groups with every session as a top-level row.
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const currentGroup = list.current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(list.current as SessionId))?.workspaceId as string | undefined)
        ?? UNGROUPED_KEY
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded ? g.sessions.map(session => sessionNode(session, descendants)) : [],
    })
  }
  return groups
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants))
}

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)

  const workspaceBySession = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title)
    }
  }
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: summary.running,
        runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
        ...(summary.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: summary.pendingInteraction }),
        completed: summary.completed === true,
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the session's last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

/** One rendered row of the recent-files directory tree: a path segment at its depth. */
export interface RecentFileTreeRow {
  /** Segment depth below the path root; the renderer indents by it. */
  depth: number
  /** `dir` rows render with a trailing separator. */
  kind: 'dir' | 'file'
  /** The segment's own name (never empty; separators were split off). */
  name: string
  /** The row's full path from the root, for the clipped-name tooltip. */
  path: string
}

/** One directory node of the recent-files tree: subdirectories and leaf names. */
interface RecentFileDir {
  dirs: Map<string, RecentFileDir>
  files: string[]
}

/**
 * Split one path into its non-empty segments on both separators, so POSIX
 * and Windows roots alike lose their leading separator (a drive letter like
 * `C:` remains a first segment).
 */
function pathSegments(path: string): string[] {
  return path.split(/[/\\]/).filter(segment => segment !== '')
}

/**
 * The session hover card's recent-files directory tree: the recency-ordered
 * path list folded into nested segments and rendered depth-first with each
 * level's directories before its files (both in the order the paths arrived,
 * which is most-recently-modified first). Two compaction rules keep the card
 * short: a single file renders as one flat VSCode-style path row (no dir
 * rows at all), and a run of directories where every level holds exactly one
 * subdirectory and no file merges into one row — `src/client/rows/` renders
 * as a single merged row instead of three. Paths inside `root` (the
 * session's project directory) display relative to it; paths outside keep
 * their full form. The render budget is `rowLimit` rows — every retained
 * but unrendered file counts into `hiddenFiles` so the card can report the
 * exact remainder.
 * @param paths - recency-ordered distinct paths (exactly one of the
 *   projection's `recentInputs`/`recentOutputs` lists; deduplicated
 *   defensively here regardless).
 * @param rowLimit - maximum rendered `dir` + `file` rows.
 * @param root - the project directory to shorten; omitted keeps paths verbatim.
 * @returns the flattened rows and the number of files kept off the card.
 */
export function recentFileTree(
  paths: readonly string[],
  rowLimit: number,
  root?: string,
): { rows: readonly RecentFileTreeRow[]; hiddenFiles: number } {
  const displayOf = (path: string): string => {
    if (root === undefined) return path
    const base = root.replace(/[/\\]+$/, '')
    if (path === base) return ''
    const separator = path[base.length]
    if (path.startsWith(base) && (separator === '/' || separator === '\\')) {
      return path.slice(base.length)
    }
    return path
  }
  const treeRoot: RecentFileDir = { dirs: new Map(), files: [] }
  const seen = new Set<string>()
  let fileCount = 0
  let singlePath = ''
  for (const path of paths) {
    if (seen.has(path)) continue
    const display = displayOf(path)
    const segments = pathSegments(display)
    if (segments.length === 0) continue
    seen.add(path)
    if (fileCount === 0) singlePath = segments.join('/')
    fileCount += 1
    let dir = treeRoot
    for (const segment of segments.slice(0, -1)) {
      let child = dir.dirs.get(segment)
      if (child === undefined) {
        child = { dirs: new Map(), files: [] }
        dir.dirs.set(segment, child)
      }
      dir = child
    }
    const name = segments.at(-1) as string
    if (!dir.files.includes(name)) dir.files.push(name)
  }
  // VSCode-style single-file display: one path, one flat row. The path is
  // the row's name (shortened under `root`), so a lone deep file needs no
  // directory scaffolding.
  if (fileCount === 1) {
    return { rows: [{ depth: 0, kind: 'file', name: singlePath, path: singlePath }], hiddenFiles: 0 }
  }
  const rows: RecentFileTreeRow[] = []
  let renderedFiles = 0
  /**
   * Emit one row for `name` (a directory) merged with any descending
   * singleton chain — every level that holds exactly one subdirectory and no
   * file of its own — then recurse into the chain end's children. A file
   * at any level stops the chain there, so `src/client/` with `tree.ts`
   * still renders `src` and its chain separately.
   * @param name - this directory's segment.
   * @param dir - this directory's node.
   * @param depth - the row's indent depth.
   * @param prefix - accumulated path before this directory's segment.
   */
  const walk = (name: string, dir: RecentFileDir, depth: number, prefix: string): void => {
    if (rows.length >= rowLimit) return
    const chain: string[] = [name]
    let node = dir
    let chainPrefix = `${prefix}${name}/`
    while (node.dirs.size === 1 && node.files.length === 0) {
      // The size guard means this loop body runs exactly once.
      for (const [nextName, child] of node.dirs) {
        chain.push(nextName)
        chainPrefix += `${nextName}/`
        node = child
      }
    }
    rows.push({ depth, kind: 'dir', name: chain.join('/'), path: chainPrefix })
    for (const [childName, child] of node.dirs) {
      if (rows.length >= rowLimit) return
      walk(childName, child, depth + 1, chainPrefix)
    }
    for (const childName of node.files) {
      if (rows.length >= rowLimit) return
      rows.push({ depth: depth + 1, kind: 'file', name: childName, path: `${chainPrefix}${childName}` })
      renderedFiles += 1
    }
  }
  for (const [name, dir] of treeRoot.dirs) walk(name, dir, 0, '')
  for (const name of treeRoot.files) {
    if (rows.length >= rowLimit) return { rows, hiddenFiles: fileCount - renderedFiles }
    rows.push({ depth: 0, kind: 'file', name, path: name })
    renderedFiles += 1
  }
  return { rows, hiddenFiles: fileCount - renderedFiles }
}
