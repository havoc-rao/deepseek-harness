// File-mutation toolview registrant: the keyed toolview hole for the `edit`
// and `write` tools, contributed by this plugin instead of the ui-tool core.
// The row composes the shared ToolRow from the ui-tool-kit (chrome, running
// sweep, whole-row expand) and feeds it the applied diff as ToolRow's `diff`
// card material, so the change renders through DiffBlock in the collapsed-by-
// default expanded body — the same unified interaction every other card row
// has. The summary stays a path link (the file-tool interaction) that opens
// through the host, trailed at the row's right edge by the call's total +A -R
// line counts (the collapsed form of the diff card's footer); an errored
// mutation (write/edit return no diff on `result.isError`) keeps the
// model-facing error text on ToolRow's Output section, its first line in the
// collapsed summary.

import { Fragment, type ReactNode } from 'react'
import { IconEditOutline16, diffLineCounts, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { diffCardModel, toolRowModel, ToolRow } from '@deepseek-ai/dsh-client-ui-tool-kit/client'
import css from './file-mutation-row.module.css'

/** Full row props: the toolview runtime share plus the standard locale seat. */
export type FileMutationRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * The collapsed row's trailing +/- suffix, nonzero terms only: the call's TOTAL
 * added/removed line counts, so the change magnitude reads at the row's right
 * edge without expanding the diff card (the in-card badge is per hunk; the
 * footer totals equal this). The terms sit in a small layer-1 chip so they read
 * as a badge, and each is colored to match the in-card badge — `+` on the
 * success token, `-` on the error token — while ToolRow's `.summarySuffix` slot
 * keeps the geometry; the signs carry the meaning so the color is
 * reinforcement. Null when the call changes nothing.
 * @param diffs - the validated hunks off the diff card model.
 * @returns the colored `+A -R` suffix chip, or null for a no-op set.
 */
function diffSuffix(diffs: readonly DiffHunk[]): ReactNode | null {
  const { added, removed } = diffLineCounts(diffs)
  if (added === 0 && removed === 0) return null
  const terms: ReactNode[] = []
  if (added > 0) terms.push(<span key="add" className={css.suffixAdd}>+{added}</span>)
  if (removed > 0) terms.push(<span key="del" className={css.suffixDel}>-{removed}</span>)
  return (
    <span className={css.suffixChip}>
      {terms.map((node, index) => (
        <Fragment key={index}>
          {index > 0 && ' '}
          {node}
        </Fragment>
      ))}
    </span>
  )
}

/**
 * File-mutation row: icon + {Edit,Write} · {path} in the shared ToolRow chrome,
 * with the applied diff as the row's collapsed-by-default card body and the
 * call's total +/- counts trailing the collapsed summary. The summary is a
 * path link (a file tool's interaction); the host's `openFile` resolves it
 * against the session cwd, so this passes the tool's own path verbatim. An
 * errored mutation has no diff card, so ToolRow surfaces the model-facing
 * error text through its Output section and its first line in the collapsed
 * summary instead.
 */
export function FileMutationRow({ toolName, block, cwd, home, openFile, inspect, t }: FileMutationRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const diff = diffCardModel(block)
  const summarySuffix = diff === null ? null : diffSuffix(diff.card.diffs)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconEditOutline16 size={14} />}
      title={model.title}
      summary={model.summary}
      summarySuffix={summarySuffix}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      diff={diff}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}
