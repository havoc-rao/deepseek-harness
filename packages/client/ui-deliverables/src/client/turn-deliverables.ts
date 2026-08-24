/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: the vocabulary is the mutation tools' own follow-along
 * `locations`, never the closing prose.
 */
import type {
  ConversationNodeDefinition, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable turn file-domain facts: the files the turn wrote and the files it read. */
export interface DeliverablesTurnData {
  /** Successful mutation paths accumulated in this Turn (write/edit outputs). */
  readonly produced: readonly ProducedPath[]
  /** Successful read-window paths accumulated in this Turn (inputs). */
  readonly read: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, ToolResultNode['callView']>
}

/**
 * Paths a call view reports having created or changed, by render intent rather
 * than tool name: a diff card, or a generic card whose kind is `edit` (the
 * shape `str_replace_editor`'s insert presents). Every other card produces
 * nothing to open — a read looked, a delete removed, a terminal ran. Only
 * root call views enter this Turn accumulator; nested Code Mode dispatches
 * preserve the pre-assembly behavior and do not contribute independently.
 */
function producedPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') {
    return (view.locations ?? []).map(location => location.path)
  }
  return []
}

/**
 * Paths a call view reports having read, by render intent rather than tool
 * name: a generic card whose kind is `read` (the shape the read tool and
 * `str_replace_editor`'s `view` present). Every other card read nothing into
 * the file domain — a mutation produced, a terminal ran.
 */
function readPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'generic' && view.kind === 'read') {
    return (view.locations ?? []).map(location => location.path)
  }
  return []
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the mutation tools' own follow-along `locations`, not the
 * closing prose: a produced file must be listed whether or not the model
 * remembered to name it. A mutation is recognized by render intent, not by
 * tool name — a diff card, or a generic card whose `kind` is `edit` (the shape
 * `str_replace_editor`'s insert presents) — so a new mutation tool joins by
 * declaring what it does. Reads contribute nothing (looking at a file does not
 * produce it), and neither do deletes (there is nothing left to open) or
 * failed calls. Paths keep first-seen order and appear once, so a file written
 * and then edited in the same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Files read by one Turn data value: mirrored from the read cards' own
 * follow-along `locations` like {@link producedForClosing}, with the same
 * seq gate and dedupe — a file read several times in one turn is one entry.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Read paths in first-seen order; empty when the turn read nothing.
 */
export function readForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const read of data.read) {
    if (read.seq > seq || seen.has(read.path)) continue
    seen.add(read.path)
    paths.push(read.path)
  }
  return paths
}

/** One turn's file-domain match: what the turn wrote plus what it read. */
export interface TurnFilesMatch {
  /** Successful mutation paths, first-seen (the produced-chip lane). */
  produced: readonly string[]
  /** Successful read-window paths, first-seen (the read-chip lane). */
  read: readonly string[]
}

/**
 * Claim the turn-tail chain on every turn: the row is the talk box's file
 * ledger, showing produced chips when the turn wrote files, read chips when
 * it read files, and the session-wide change totals (read from the
 * projection inside the component) whenever the session has changed
 * anything. The decline decision cannot live in this pure selector — the
 * totals are not owner props — so the component answers "nothing to show"
 * itself after mounting, and this entry stays the chain's unconditional
 * owner while it is composed in.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns the produced and read path lists as the component's match.
 */
export function selectTurnFiles(owner: TurnTailOwnerProps): TurnFilesMatch {
  const data = owner.turn.data.get('deliverables')
  return {
    produced: producedForClosing(data, owner.seq),
    read: readForClosing(data, owner.seq),
  }
}

/**
 * The produced half of {@link selectTurnFiles}, for prose mentions: only
 * produced files are linkable in the closing message (reading a file does
 * not make it worth linking).
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the mention vocabulary's match.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] {
  return producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
}

/** Turn-local successful mutation/read accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [], read: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        match.view?.for === 'call' ? match.view.view : null,
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const view = context.state.calls.get(callId) ?? null
    const producedAdditions = producedPaths(view).map(path => ({ seq: match.event.seq, path }))
    const readAdditions = readPaths(view).map(path => ({ seq: match.event.seq, path }))
    if (producedAdditions.length === 0 && readAdditions.length === 0) return context.state
    return {
      ...context.state,
      produced: [...context.state.produced, ...producedAdditions],
      read: [...context.state.read, ...readAdditions],
    }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced, read: context.state.read },
    },
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param paths - The turn's produced paths (tool order, already deduped).
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
