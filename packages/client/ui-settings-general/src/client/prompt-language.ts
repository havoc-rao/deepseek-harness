/**
 * Prompt-language preference: the default language of newly composed prompts,
 * persisted in browser-local storage so the choice sticks across sessions.
 * This is the sole owner of the storage key (a stable, documented contract:
 * `dsh.promptLanguage`); consumers read the raw key through the same storage
 * face when they need the current value outside this page.
 */

/** localStorage key holding the default prompt language (`'zh' | 'en'`). */
export const PROMPT_LANGUAGE_STORAGE_KEY = 'dsh.promptLanguage'

/** The selectable prompt languages. */
export type PromptLanguage = 'zh' | 'en'

/** The prompt-language default when nothing has been stored yet. */
export const DEFAULT_PROMPT_LANGUAGE: PromptLanguage = 'en'

const PROMPT_LANGUAGES: readonly PromptLanguage[] = ['zh', 'en']

/** localStorage-like sink; tests inject a fake, production uses the global. */
export type PromptLanguageStorage = Pick<Storage, 'getItem' | 'setItem'>

function resolveStorage(): PromptLanguageStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

/** Whether the value is one of the selectable prompt languages. */
export function isPromptLanguage(value: unknown): value is PromptLanguage {
  return PROMPT_LANGUAGES.includes(value as PromptLanguage)
}

/**
 * Read the persisted prompt language, falling back to the default when the
 * value is absent, unreadable, or malformed (storage failures never throw).
 * @param storage - storage sink override (tests).
 * @returns the persisted language or {@link DEFAULT_PROMPT_LANGUAGE}.
 */
export function readPromptLanguage(storage: PromptLanguageStorage | undefined = resolveStorage()): PromptLanguage {
  try {
    const raw = storage?.getItem(PROMPT_LANGUAGE_STORAGE_KEY)
    return isPromptLanguage(raw) ? raw : DEFAULT_PROMPT_LANGUAGE
  } catch {
    return DEFAULT_PROMPT_LANGUAGE
  }
}

/**
 * Persist the prompt language; failures are swallowed (best-effort only).
 * @param language - the language to store.
 * @param storage - storage sink override (tests).
 */
export function writePromptLanguage(language: PromptLanguage, storage: PromptLanguageStorage | undefined = resolveStorage()): void {
  try {
    storage?.setItem(PROMPT_LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Best-effort: an unavailable storage must not break the settings page.
  }
}
