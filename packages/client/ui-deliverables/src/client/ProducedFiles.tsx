// ProducedFiles: the produced-file row a finished turn ends with. The paths
// come pre-matched by the turn-tail chain from the mutation tools'
// follow-along locations, never from the closing prose. Clicking one goes
// through the same openFile the tool rows use — the Host's own opener, on the
// Host machine. Below the chip lane, the row also shows the session's
// cumulative change totals (files and +/- lines folded by the durable
// sessionStats projection), so every talk box records how much the session
// has changed so far — including turns that only read.

import { useLayoutEffect, useRef, useState } from 'react'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: merges the sessionStats key into SessionProjectionMap so
// useProjection('sessionStats') types against the whole-log change fields.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** At most six chips compete for the one-line summary; every other path stays counted. */
const SHOWN_LIMIT = 6

/**
 * Select the largest prefix whose measured chips and exact remainder fit.
 * @param available - usable width of the one-line file lane.
 * @param gap - computed flex gap between adjacent visible items.
 * @param chipWidths - measured widths for the candidate file chips.
 * @param moreWidthsByShown - exact localized remainder width for each shown count.
 * @returns Number of leading chips to render.
 */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  const prefix = [0]
  let prefixWidth = 0
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  let largestFit = 0
  for (const [shown, width] of prefix.entries()) {
    const more = moreWidthsByShown[shown]
    const items = shown + (more === undefined ? 0 : 1)
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
}

/** Matched paths plus the opener, locale, injected Host capability, and the projection seat. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
  useProjection: UseProjection
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as openable chips, trailed by the
 * session-wide change totals when the session has changed anything.
 * @param props - selector-matched paths, the chat view's file opener, the
 * projection seat, and the locale seat.
 * @returns The produced-files row, or null when nothing to show.
 */
export function ProducedFiles({
  matched: paths, openFile, isLoopback, useHostDescription, useProjection, t,
}: ProducedFilesProps) {
  const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
  const canOpenPath = isLoopback && hostCanOpenPath
  // The whole-log change totals ride the durable sessionStats projection, so
  // paging and compaction cannot move them; absent unit (a composition
  // without session-stats) means no totals line, matching the graceful off
  // state of every projection consumer.
  const stats = useProjection('sessionStats')
  const totals = stats !== undefined
    && (stats.filesChanged > 0 || stats.addedLines > 0 || stats.removedLines > 0)
    ? { files: stats.filesChanged, added: stats.addedLines, removed: stats.removedLines }
    : null
  const limit = Math.min(paths.length, SHOWN_LIMIT)
  const [shownCount, setShownCount] = useState(limit)
  const rowRef = useRef<HTMLDivElement>(null)
  const chipProbes = useRef<Array<HTMLButtonElement | null>>([])
  const moreProbe = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const row = rowRef.current
    const remainderProbe = moreProbe.current
    // A turn that produced no files mounts the ledger without the chip lane,
    // so both refs stay null and there is nothing to measure.
    if (row === null || remainderProbe === null) return
    const measure = (): void => {
      const styles = getComputedStyle(row)
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
      // React attaches every still-mounted callback ref before layout effects run.
      const activeChipProbes = chipProbes.current.slice(0, limit) as HTMLButtonElement[]
      const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
      const more = Array.from({ length: limit + 1 }, (_, candidate) => {
        if (paths.length === candidate) return undefined
        remainderProbe.textContent = moreLabel(t, paths.length - candidate)
        return remainderProbe.getBoundingClientRect().width
      })
      setShownCount(fitProducedFiles(row.clientWidth, gap, chips, more))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const probe of [...chipProbes.current, moreProbe.current]) {
      if (probe !== null) observer.observe(probe)
    }
    return () => { observer.disconnect() }
  }, [limit, paths, t])

  // The chain elects this entry on every closed turn (the selector never
  // declines), so the component must answer "nothing to show" itself: no
  // produced chips and no session change totals.
  if (paths.length === 0 && totals === null) return null

  const visibleCount = Math.min(shownCount, limit)
  const shown = paths.slice(0, visibleCount)
  const hidden = paths.length - shown.length
  return (
    <div className={css.root}>
      {paths.length > 0 && <span className={css.label}>{t('produced.label')}</span>}
      {paths.length > 0 && (
        <div ref={rowRef} className={css.row} data-produced-files-row>
          {shown.map(path => (
            <button
              key={path}
              type="button"
              className={css.file}
              // The full path is the disambiguator when two turns produce files
              // that share a basename; the chip itself stays short.
              title={path}
              aria-label={t('produced.open', { name: path })}
              onClick={() => { openFile(path) }}
            >
              {basename(path)}
            </button>
          ))}
          {hidden > 0 && <span className={css.more}>{moreLabel(t, hidden)}</span>}
        </div>
      )}
      {totals !== null && (
        <div className={css.totals} data-produced-files-totals>
          {t('produced.totals', {
            files: String(totals.files),
            added: String(totals.added),
            removed: String(totals.removed),
          })}
        </div>
      )}
      {hidden > 0 && canOpenPath && (
        <button type="button" className={css.showFolder} onClick={() => { openFile('.') }}>
          {t('produced.showInFolder')}
        </button>
      )}
      <div className={css.measure} aria-hidden="true">
        {paths.slice(0, limit).map((path, index) => (
          <button
            key={path}
            ref={(node) => { chipProbes.current[index] = node }}
            type="button"
            tabIndex={-1}
            className={`${css.file} ${css.probe}`}
          >
            {basename(path)}
          </button>
        ))}
        <span ref={moreProbe} className={`${css.more} ${css.probe}`} />
      </div>
    </div>
  )
}
