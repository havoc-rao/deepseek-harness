/** Optional dsh-hotkey owner registration; business handlers stay with the mounted question flow. */
import type { Context } from '@deepseek-ai/cordis'
import { isBehindModal } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from './locales.ts'

/** Commands delivered synchronously to the current editable question card. */
export type QuestionHotkey = 'submit' | 'cancel' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Callback injected into the composer; its disposer withdraws this render occurrence. */
export type RegisterQuestionHotkeys = (element: HTMLElement, run: (command: QuestionHotkey) => boolean) => () => void

/** Structural subset of dsh-hotkey/client-contract; the optional plugin is not a bundled dependency. */
export interface HotkeyService {
  /** Activate one reference to a scene; return its idempotent release callback. */
  activateScope(scope: string): () => void
  /** Register an owner action; return its idempotent unregister callback. */
  registerAction(spec: {
    scope: string
    priority: number
    id: string
    def: string
    group: 'input'
    zh: string
    en: string
    run(context: { event?: KeyboardEvent }): boolean
    available(): boolean
  }): () => void
}

/**
 * Install one action set per plugin, independent of the number of composer occurrences.
 * @param ctx - Question plugin context; registrations follow the optional service lifetime.
 * @returns Mount registration callback; unmount withdraws the occurrence immediately.
 */
export function questionHotkeys(ctx: Context): RegisterQuestionHotkeys {
  const seats = new Map<HTMLElement, (command: QuestionHotkey) => boolean>()
  let activate: (() => () => void) | undefined
  const releases = new Map<HTMLElement, () => void>()
  const target = (): HTMLElement | undefined => {
    const visible = [...seats.keys()].filter(element => element.isConnected && element.getClientRects().length > 0)
    const focused = visible.find(element => element.contains(document.activeElement))
    return focused ?? (visible.length === 1 ? visible[0] : undefined)
  }
  ctx.inject(['hotkey'], (scope) => {
    const hotkey = scope.get('hotkey') as HotkeyService
    scope.effect(() => {
      activate = () => hotkey.activateScope('question')
      for (const element of seats.keys()) releases.set(element, activate())
      return () => {
        activate = undefined
        for (const release of releases.values()) release()
        releases.clear()
      }
    }, 'ui-user-questions: question hotkey scope')
    const commands: readonly QuestionHotkey[] = ['submit', 'cancel', 1, 2, 3, 4, 5, 6, 7, 8, 9]
    for (const command of commands) {
      scope.effect(() => hotkey.registerAction({
        id: `question.${typeof command === 'number' ? `option.${String(command)}` : command}`,
        def: command === 'submit' ? 'ctrl+enter' : command === 'cancel' ? 'escape' : String(command),
        group: 'input',
        scope: 'question',
        priority: 100,
        zh: typeof command === 'number' ? zh['hotkey.option'].replace('{number}', String(command)) : zh[`hotkey.${command}`],
        en: typeof command === 'number' ? en['hotkey.option'].replace('{number}', String(command)) : en[`hotkey.${command}`],
        available: () => target() !== undefined,
        run: ({ event }) => {
          const element = target()
          if (element === undefined || isBehindModal(element, event)) return false
          if (event !== undefined && (event.defaultPrevented || event.repeat || event.isComposing
            || Reflect.get(event, 'keyCode') === 229)) return false
          const active = document.activeElement
          if (typeof command === 'number' && active instanceof Element
            && active.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null) return false
          return seats.get(element)?.(command) === true
        },
      }), `ui-user-questions: ${String(command)} hotkey`)
    }
  })
  ctx.effect(() => () => {
    seats.clear()
    for (const release of releases.values()) release()
    releases.clear()
  }, 'ui-user-questions: hotkey seats')
  return (element, run) => {
    releases.get(element)?.()
    seats.set(element, run)
    const release = activate?.()
    if (release !== undefined) releases.set(element, release)
    return () => {
      if (seats.get(element) !== run) return
      seats.delete(element)
      releases.get(element)?.()
      releases.delete(element)
    }
  }
}
