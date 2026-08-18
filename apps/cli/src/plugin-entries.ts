/**
 * `dsh plugin --profile <name> enable|disable|list` — inspect and toggle the
 * `disabled` flags of the profile's loader rows in its own patch layer
 * (`cordis.patch.yml`).
 *
 * The CLI has no runtime: `disable`/`enable` edit the patch file the
 * composition mounts, so the toggle is visible to every later boot and
 * hot-reloads on long-lived surfaces (the web/electron hosts watch this exact
 * file through Cordis HMR). `disable <row>` writes `disabled: true` for the
 * row (creating the patch entry when absent); `enable <row>` removes that
 * override — restoring the row's declared default instead of stealing control
 * from lower bundle layers — and drops the patch entry when it becomes
 * id-only. Both are idempotent: re-running reports the state instead of
 * rewriting the file. `list` prints the composed rows with their entry ids and
 * effective states.
 *
 * The row is named by its entry id in the composed tree, or — when no row
 * carries that id — by its `name` (so a bundle row inserted as
 * `name: dsh-better-sidebar` with `id: better-sidebar` accepts either);
 * a row resolved by name is patched under its real id. A literal id that no
 * composed row carries still writes a patch entry (a bundle may insert the
 * row later), and a stale entry a previous literal-id toggle left behind is
 * cleaned up when the same invocation resolves to a different id.
 *
 * The file is edited as a `yaml` v2 AST, never re-serialized from plain
 * objects: hand-written comments, flow/block styles, and `!!js` expression
 * nodes in other fields survive untouched. After the edit the composed tree is
 * re-derived (boot-free, best-effort) so a typo'd id or a lower-layer disable
 * that still stands is reported as a warning instead of a silent no-op.
 * @module @deepseek-ai/dsh/plugin-entries
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isScalar, parseDocument, Scalar, YAMLMap, YAMLSeq, type Document } from 'yaml'
import {
  composeEntries,
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  resolveProfileDir,
} from '@deepseek-ai/dsh-app-boot'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { homePatchPath, INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/** The row's composed `disabled` state, as far as it can be known without booting. */
type ComposedDisabled = 'disabled' | 'enabled' | 'unknown'

/**
 * Whether a loader row is disabled in the composed tree.
 *
 * Only a literal boolean is knowable here: the Loader evaluates `!!js`
 * expressions at mount time, so an expression node's outcome is `unknown`
 * without booting.
 * @param options - the composed `EntryOptions` of one row.
 * @returns the row's disabled state, or `unknown` for an expression.
 */
function composedDisabled(options: { disabled?: unknown }): ComposedDisabled {
  if (typeof options.disabled === 'boolean') return options.disabled ? 'disabled' : 'enabled'
  return options.disabled === undefined || options.disabled === null ? 'enabled' : 'unknown'
}

/**
 * Compose the profile's persistent tree — bundle layers, the profile's own
 * patch layer, and the home-level layer; `--patch` overlays are launch-time
 * and not part of the persistent composition.
 * @param profile - the profile name.
 * @returns the composed rows, or `undefined` when the profile cannot be
 * composed (a broken bundle or an unreadable layer).
 */
function composeProfileRows(profile: string): { rows: readonly EntryOptions[] } | undefined {
  try {
    const loaded = loadProfile(NAME, profile, INSTALL_ANCHOR)
    return {
      rows: composeEntries([
        loaded.layers.flatMap(layer => layer.patches),
        loaded.patches,
        loadOptionalPatches(NAME, homePatchPath()) ?? [],
      ]),
    }
  } catch {
    // Composing must never block a toggle: disabling a row is exactly what a
    // user does to a broken tree, so the caller falls back to the literal id.
    return undefined
  }
}

interface ComposedRow {
  /** Whether the profile's tree could be composed at all. */
  composed: boolean
  /** The row's state; set only when `composed` is true and the row exists. */
  state?: ComposedDisabled
}

/**
 * Read one row's state in the composed tree (as of the current patch file).
 * @param profile - the profile name.
 * @param id - the row whose composed state is read.
 * @returns the row's state, or `composed: false` when the tree cannot be
 * composed or the row has no `id` in it.
 */
function composedRowState(profile: string, id: string): ComposedRow {
  const composed = composeProfileRows(profile)
  if (composed === undefined) return { composed: false }
  const row = composed.rows.find(candidate => candidate.id === id)
  return row === undefined ? { composed: true } : { composed: true, state: composedDisabled(row) }
}

/**
 * Locate the patch entry whose `id` value equals `id`, and its `disabled` pair
 * when present.
 * @param seq - the top-level patch-list sequence.
 * @param id - the targeted entry id.
 * @returns the entry map and its `disabled` pair, or `undefined` when absent.
 */
function findEntry(seq: YAMLSeq, id: string): { map: YAMLMap; disabledPair?: { key: unknown; value: unknown } } | undefined {
  for (const item of seq.items) {
    if (!(item instanceof YAMLMap)) continue
    const idValue = item.get('id', true)
    if (isScalar(idValue) && idValue.value === id) {
      const disabledPair = item.items.find(pair => isScalar(pair.key) && pair.key.value === 'disabled')
      return disabledPair === undefined ? { map: item } : { map: item, disabledPair }
    }
  }
  return undefined
}

/**
 * Whether a patch entry only sets `id` and `disabled` — exactly the artifact a
 * literal-id toggle writes, and therefore safe to drop when the invocation
 * resolves the same row to a different id.
 * @param map - one patch entry.
 * @returns true when every key is `id` or `disabled`.
 */
function isBareToggleEntry(map: YAMLMap): boolean {
  return map.items.every(pair => isScalar(pair.key) && (pair.key.value === 'id' || pair.key.value === 'disabled'))
}

/**
 * Apply a toggle to the parsed patch-list document in place.
 * @param doc - the parsed profile patch layer.
 * @param id - the targeted entry id.
 * @param action - `disable` writes `disabled: true`; `enable` removes the override.
 */
function applyToggle(doc: Document, id: string, action: 'enable' | 'disable'): void {
  const seq = doc.contents
  if (!(seq instanceof YAMLSeq)) {
    throw new Error(`${NAME}: the profile patch layer must be a top-level YAML array of loader patch entries`)
  }
  const entry = findEntry(seq, id)
  if (action === 'disable') {
    if (entry === undefined) {
      // Force block style: appending to a flow `[]` would inline the entry as
      // `[{id: ..., disabled: true}]`, an unreadable diff for a hand-edited
      // file. Existing block-style files have `flow` null or false and are
      // unaffected.
      seq.flow = false
      const map = new YAMLMap()
      map.add({ key: 'id', value: id })
      map.add({ key: 'disabled', value: true })
      seq.add(map)
      return
    }
    if (entry.disabledPair === undefined) {
      entry.map.add({ key: 'disabled', value: true })
      return
    }
    const value = entry.disabledPair.value
    if (isScalar(value) && value.value === true) return
    // A literal true replaces any prior value — including a `!!js` expression
    // — because the flag itself is the whole point of a CLI toggle.
    entry.disabledPair.value = new Scalar(true)
    return
  }
  if (entry === undefined || entry.disabledPair === undefined) return
  entry.map.items = entry.map.items.filter(pair => pair !== entry.disabledPair)
  // An entry left with only its `id` key patches nothing; drop it entirely so
  // disable→enable cycles leave no residue. When that entry carried the file's
  // leading comments (a re-parsed template's header sits on the first item),
  // hoist them to the sequence so an emptied file keeps its header.
  if (entry.map.items.length === 1
    && isScalar(entry.map.items[0]?.key) && entry.map.items[0].key.value === 'id') {
    if (seq.items.length === 1 && entry.map.commentBefore !== undefined) {
      seq.commentBefore = seq.commentBefore === undefined || seq.commentBefore === ''
        ? entry.map.commentBefore
        : `${seq.commentBefore}\n${entry.map.commentBefore}`
    }
    seq.items = seq.items.filter(item => item !== entry.map)
  }
}

/** The resolved toggle: the patch id and any row-name the input matched. */
interface ToggleTarget {
  id: string
  /** The composed row the id resolves to; undefined when matched by nothing. */
  row?: EntryOptions
  /** The literal input, when it differed from the patch id (name-matched). */
  matchedByName?: string
}

/**
 * Resolve the invocation's row name and drop a stale literal-id entry the
 * patch layer may carry from an earlier toggle under the pre-resolution id.
 * @param doc - the parsed profile patch layer.
 * @param profile - the profile name.
 * @param input - the invocation's row name.
 * @returns the patch id and match provenance.
 */
function resolveToggleTarget(doc: Document, profile: string, input: string): ToggleTarget {
  const composed = composeProfileRows(profile)
  if (composed === undefined) return { id: input }
  const byId = composed.rows.find(row => row.id === input)
  if (byId !== undefined) return { id: input, row: byId }
  const byName = composed.rows.find(row => row.name === input)
  if (byName === undefined) return { id: input }
  if (typeof byName.id !== 'string' || byName.id === '') {
    throw new Error(`${NAME}: row ${JSON.stringify(input)} has no entry id and cannot be toggled`)
  }
  // Drop the bare entry the previous command wrote under the literal id that
  // matched nothing, so name resolution cannot stack dead rows in the file.
  const seq = doc.contents
  if (seq instanceof YAMLSeq) {
    const stale = findEntry(seq, input)
    if (stale !== undefined && isBareToggleEntry(stale.map)) {
      seq.items = seq.items.filter(item => item !== stale.map)
    }
  }
  return { id: byName.id, row: byName, matchedByName: input }
}

/**
 * Run one `dsh plugin enable|disable` invocation: initialize the profile when
 * missing (like every `dsh plugin` verb), apply the toggle to the profile's
 * own patch layer, and report the composed outcome.
 * @param profile - the profile name.
 * @param action - `enable` or `disable`.
 * @param id - the loader row the toggle targets (an entry id, or a row name).
 * @returns the process exit code: 0 on success (including an idempotent
 * no-op), 1 on a profile- or file-level failure.
 */
export function runToggle(profileName: string, action: 'enable' | 'disable', input: string): number {
  const dir = resolveProfileDir(profileName)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, PROFILE_TEMPLATES[profileName] ?? DEFAULT_PROFILE_BUNDLES)
    process.stderr.write(`${NAME}: initialized profile ${profileName} at ${dir}\n`)
  }
  const patchPath = join(dir, PROFILE_PATCH_FILENAME)
  const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]'
  const doc = parseDocument(original)
  if (doc.errors.length > 0) {
    const message = doc.errors[0]?.message ?? 'unknown parse error'
    process.stderr.write(`${NAME}: failed to parse ${patchPath}: ${message}\n`)
    return 1
  }
  if (!(doc.contents instanceof YAMLSeq)) {
    process.stderr.write(`${NAME}: ${patchPath} must be a top-level YAML array of loader patch entries\n`)
    return 1
  }
  let target: ToggleTarget
  try {
    target = resolveToggleTarget(doc, profileName, input)
  } catch (error) {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  try {
    applyToggle(doc, target.id, action)
  } catch (error) {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  const matchNote = target.matchedByName === undefined ? '' : ` (matched by row name ${target.matchedByName})`
  const next = doc.toString()
  if (next.trimEnd() === original.trimEnd()) {
    const composed = composedRowState(profileName, target.id)
    if (composed.composed && composed.state === undefined) {
      process.stderr.write(
        `${NAME}: warning: no composed row with id ${JSON.stringify(target.id)}; `
        + `use 'dsh plugin --profile ${profileName} list' to see the rows and their ids\n`,
      )
    } else if (action === 'enable' && composed.state === 'disabled') {
      process.stderr.write(
        `${NAME}: warning: ${JSON.stringify(target.id)} is disabled by a lower layer (a bundle or the home-level patch); `
        + `write 'disabled: false' in ${patchPath} to force it on\n`,
      )
    }
    process.stdout.write(
      action === 'disable'
        ? `${NAME}: ${target.id} is already disabled in ${patchPath}\n`
        : `${NAME}: ${target.id} has no disabled override in ${patchPath}; nothing to enable\n`,
    )
    return 0
  }
  writeFileSync(patchPath, next)
  process.stdout.write(
    action === 'disable'
      ? `${NAME}: disabled ${target.id}${matchNote} in ${patchPath} (hot-reloads on running web/electron surfaces)\n`
      : `${NAME}: enabled ${target.id}${matchNote} (removed its disabled override from ${patchPath})\n`,
  )
  const composed = composedRowState(profileName, target.id)
  if (composed.composed && composed.state === undefined) {
    process.stderr.write(
      `${NAME}: warning: no composed row with id ${JSON.stringify(target.id)}; `
      + `use 'dsh plugin --profile ${profileName} list' to see the rows and their ids\n`,
    )
  } else if (action === 'enable' && composed.state === 'disabled') {
    process.stderr.write(
      `${NAME}: warning: ${JSON.stringify(target.id)} is still disabled by a lower layer (a bundle or the home-level patch); `
      + `write 'disabled: false' in ${patchPath} to force it on\n`,
    )
  }
  return 0
}

/** The state labels shown by the list command, aligned to 10 columns. */
const STATE_LABELS: Record<ComposedDisabled, string> = {
  disabled: 'disabled',
  enabled: 'enabled',
  unknown: 'expression',
}

/**
 * Run one `dsh plugin list` invocation: print every row of the profile's
 * composed tree with its entry id and effective state. Read-only: the profile
 * is never initialized or modified, so a composed tree is required.
 * @param profile - the profile name.
 * @returns the process exit code: 0 on success, 1 when the tree cannot be
 * composed (a missing profile or a broken bundle layer).
 */
export function runList(profileName: string): number {
  let composed: { rows: readonly EntryOptions[] }
  try {
    const loaded = loadProfile(NAME, profileName, INSTALL_ANCHOR)
    composed = {
      rows: composeEntries([
        loaded.layers.flatMap(layer => layer.patches),
        loaded.patches,
        loadOptionalPatches(NAME, homePatchPath()) ?? [],
      ]),
    }
  } catch (error) {
    process.stderr.write(`${NAME}: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  const idOf = (row: EntryOptions): string => typeof row.id === 'string' && row.id !== '' ? row.id : '(no id)'
  const counts: Record<ComposedDisabled, number> = { disabled: 0, enabled: 0, unknown: 0 }
  for (const row of composed.rows) counts[composedDisabled(row)]++
  const idWidth = Math.min(Math.max(2, ...composed.rows.map(row => idOf(row).length)), 32)
  process.stdout.write(
    `${NAME}: ${composed.rows.length} row(s) composed in profile ${profileName} `
    + `(${counts.enabled} enabled, ${counts.disabled} disabled, ${counts.unknown} by expression)\n`,
  )
  for (const row of composed.rows) {
    process.stdout.write(`  ${idOf(row).padEnd(idWidth)}  ${STATE_LABELS[composedDisabled(row)].padEnd(10)}  ${row.name}\n`)
  }
  return 0
}
