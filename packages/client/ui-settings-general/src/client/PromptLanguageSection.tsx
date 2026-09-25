/**
 * Prompt-language settings page: mark the default language of newly composed
 * prompts as 中文 or English (default English). The choice persists in
 * browser-local storage (see prompt-language.ts); the current value is read
 * once at mount and rewritten on every pick, so the page never goes stale
 * against its own last write.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings scope's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_PROMPT_LANGUAGE, readPromptLanguage, writePromptLanguage, type PromptLanguage } from './prompt-language.ts'
import css from './PromptLanguageSection.module.css'

/** Full component props: section runtime share + the standard locale seat. */
export type PromptLanguageSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'>

/** The selectable languages, self-described in their own language. */
const OPTIONS: ReadonlyArray<{ id: PromptLanguage; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
]

/**
 * Render the prompt-language page.
 * @param props - composed slot props.
 * @returns the page element tree.
 */
export function PromptLanguageSection({ t }: PromptLanguageSectionProps) {
  // Component-local viewing state; the storage write is the durable source.
  const [language, setLanguage] = useState<PromptLanguage>(() => readPromptLanguage() ?? DEFAULT_PROMPT_LANGUAGE)
  const select = (next: PromptLanguage): void => {
    setLanguage(next)
    writePromptLanguage(next)
  }
  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('promptLanguage.title')}</h2>
      <p className={css.intro}>{t('promptLanguage.description')}</p>
      <div className={css.options}>
        {OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            className={option.id === language ? `${css.option} ${css.active}` : css.option}
            aria-pressed={option.id === language}
            onClick={() => { select(option.id) }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
