/**
 * Appearance preference row registered into the General section item slot
 * (figma 501:30012 'Frame 2117131228'): title + three preference cubes, plus
 * the paper-tone entry (independent axis, never follows the system scheme).
 * The entry shows the current tone and expands in place to a selection panel
 * with one paper-identity swatch per tone. Registered by this package — the
 * theme feature owns its own settings surface. Selection follows the
 * persisted preference and tone, never the resolved active theme.
 */
import clsx from 'clsx'
import { useState } from 'react'
import {
  IconChevronDownOutline14, IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { paperToneSwatch, type PaperTone } from '../paper-tones.ts'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference and paper-tone writes (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Switch the paper tone (independent of the preference axis). */
  setPaper: (tone: PaperTone) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/** Paper-tone option order inside the expanded panel. */
const PAPER_CUBES: readonly { id: PaperTone; labelKey: ThemeKey }[] = [
  { id: 'default', labelKey: 'appearance.paper.default' },
  { id: 'cream', labelKey: 'appearance.paper.cream' },
  { id: 'sepia', labelKey: 'appearance.paper.sepia' },
  { id: 'green', labelKey: 'appearance.paper.green' },
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({ t, setTheme, setPaper, useStore }: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const paper = useStore(s => s.paper)
  // Panel expansion is view-only interaction state: it resets with the row.
  const [paperOpen, setPaperOpen] = useState(false)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('appearance.title')}</div>
      <div className={css.cubeRow}>
        {CUBES.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, preference === id && css.selected)}
            aria-pressed={preference === id}
            onClick={() => { setTheme(id) }}
          >
            <Icon />
            {t(labelKey)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={css.paperEntry}
        aria-expanded={paperOpen}
        onClick={() => { setPaperOpen(!paperOpen) }}
      >
        <span className={css.paperEntryTitle}>{t('appearance.paper.title')}</span>
        <span className={css.paperEntryValue}>{t(`appearance.paper.${paper}`)}</span>
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
