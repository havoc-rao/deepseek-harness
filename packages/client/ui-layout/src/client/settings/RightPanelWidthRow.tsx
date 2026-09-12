/**
 * Right-panel width preference row registered into the General section item
 * slot: title + body-text-only description + a stepper pill with the same
 * geometry as the theme's font-size row, stepping in tens of px because the
 * range is hundreds wide and drag is the direct fine adjustment. The displayed
 * value follows the live preference (stored width, or the derived first-open
 * width), never the click echo. Writes go through the same store action the
 * drag handle uses, so the frame and the row can never disagree.
 */
import {
  IconChevronDownOutline14, IconChevronUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { RIGHTBAR_MIN } from '../columns.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createRightPanelWidthRowStore } from './right-panel-width-store.ts'
import css from './RightPanelWidthRow.module.css'

/** One width step the stepper offers; drag remains the fine adjustment. */
export const WIDTH_STEP = 10

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface RightPanelWidthRowInjected {
  /** Set and persist the right-panel width preference (integer px). */
  setRightbarWidth: (px: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type RightPanelWidthRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createRightPanelWidthRowStore>>
  & PropsLocale<'settings.layout'> & RightPanelWidthRowInjected

/**
 * Render the right-panel width row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function RightPanelWidthRow({ t, setRightbarWidth, useStore }: RightPanelWidthRowComponentProps) {
  const width = useStore(s => s.width)
  const max = useStore(s => s.max)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('rightPanelWidth.title')}</div>
        <div className={css.desc}>{t('rightPanelWidth.description')}</div>
      </div>
      <div className={css.control}>
        <div className={css.stepper}>
          <span className={css.value}>{width}</span>
          <span className={css.arrows}>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('rightPanelWidth.increase')}
              disabled={width >= max}
              onClick={() => { setRightbarWidth(width + WIDTH_STEP) }}
            >
              <IconChevronUpOutline14 size={9} />
            </button>
            <button
              type="button"
              className={css.arrow}
              aria-label={t('rightPanelWidth.decrease')}
              disabled={width <= RIGHTBAR_MIN}
              onClick={() => { setRightbarWidth(width - WIDTH_STEP) }}
            >
              <IconChevronDownOutline14 size={9} />
            </button>
          </span>
        </div>
        <span className={css.unit}>{t('rightPanelWidth.unit')}</span>
      </div>
    </div>
  )
}
