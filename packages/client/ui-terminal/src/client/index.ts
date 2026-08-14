/**
 * Terminal surface plugin, browser half: contributes the terminal pane entry
 * into the frame-wide `shell.overlay` list slot declared by ui-layout. The
 * pane owns its open/closed state (closed initially, opened via its floating
 * toggle); PTY wiring lands in a later module. The resolved theme snapshot
 * flows into the pane through the inject face's `hooks` compartment so the
 * terminal renderer follows page theme switches without touching the cordis
 * context from React.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { en, zh, type TerminalKey } from './locales.ts'
import { createThemeSource } from './theme-source.ts'
import { TerminalPane } from './TerminalPane.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    terminal: TerminalKey
  }
}

/** Dictionary namespace of the terminal pane copy. */
const NS = 'terminal'

/** Required services: the slots registry, the locale dictionary registry, and the theme service. */
export const inject = ['slots', 'locale', 'theme']

/**
 * Client plugin body: register the pane dictionaries, then contribute the pane
 * entry into the frame-wide `shell.overlay` list slot once ui-layout declares
 * it. The theme snapshot observable is bound through the inject face's `hooks`
 * compartment, synthesizing a `useTheme` selector hook on the pane component.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-terminal: dictionaries')
  const themeSource = createThemeSource(ctx, ctx.theme)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'terminal',
    locale: NS,
    inject: () => ({ hooks: { theme: themeSource } }),
  }, TerminalPane))
}
