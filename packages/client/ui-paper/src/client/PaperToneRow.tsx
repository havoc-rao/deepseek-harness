/**
 * Paper-tone settings row registered into the General section item slot:
 * an entry showing the current tone, expanding in place to a selection
 * panel with one paper-identity swatch per tone. Independent axis — never
 * follows the system scheme; the tone id and the write route come from the
 * ui-theme service, the visual data from this package.
 */
import clsx from 'clsx'
import { useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PaperTone } from '@deepseek-ai/dsh-client-ui-theme'
import { paperToneSwatch } from '../paper-tones.ts'
import type { PaperKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createPaperRowStore } from './settings-store.ts'
import css from './PaperToneRow.module.css'

/** Injected business face: the paper-tone write (t rides the standard locale seat). */
export interface PaperRowInjected {
  /** Switch the paper tone (independent of the preference axis). */
  setPaper: (tone: PaperTone) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type PaperToneRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createPaperRowStore>>
  & PropsLocale<'settings.paper'> & PaperRowInjected

/** Paper-tone option order inside the expanded panel. */
const PAPER_CUBES: readonly { id: PaperTone; labelKey: PaperKey }[] = [
  { id: 'default', labelKey: 'paper.default' },
  { id: 'cream', labelKey: 'paper.cream' },
  { id: 'sepia', labelKey: 'paper.sepia' },
  { id: 'green', labelKey: 'paper.green' },
]

/**
 * Render the paper-tone settings row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function PaperToneRow({ t, setPaper, useStore }: PaperToneRowComponentProps) {
  const paper = useStore(s => s.paper)
  // Panel expansion is view-only interaction state: it resets with the row.
  const [paperOpen, setPaperOpen] = useState(false)
  return (
    <div className={css.group}>
      <button
        type="button"
        className={css.paperEntry}
        aria-expanded={paperOpen}
        onClick={() => { setPaperOpen(!paperOpen) }}
      >
        <span className={css.paperEntryTitle}>{t('paper.title')}</span>
        <span className={css.paperEntryValue}>{t(`paper.${paper}`)}</span>
        <IconChevronDownOutline14
          className={clsx(css.paperEntryChevron, paperOpen && css.paperEntryChevronOpen)}
        />
      </button>
      {paperOpen && (
        <div className={css.paperOptions}>
          {PAPER_CUBES.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.paperOption, paper === id && css.selected)}
              aria-pressed={paper === id}
              onClick={() => { setPaper(id) }}
            >
              <span
                className={css.paperSwatch}
                style={{ backgroundColor: paperToneSwatch(id) }}
              />
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
