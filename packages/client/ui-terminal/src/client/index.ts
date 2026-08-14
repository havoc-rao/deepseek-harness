/**
 * Terminal surface plugin, browser half: contributes the terminal pane entry
 * into the frame-wide `shell.overlay` list slot declared by ui-layout. The
 * pane owns its open/closed state (closed initially, opened via its floating
 * toggle); PTY wiring lands in a later module.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { en, zh, type TerminalKey } from './locales.ts'
import { TerminalPane } from './TerminalPane.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    terminal: TerminalKey
  }
}

/** Dictionary namespace of the terminal pane copy. */
const NS = 'terminal'

/** Required services: the slots registry and the locale dictionary registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the pane dictionaries, then contribute the pane
 * entry into the frame-wide `shell.overlay` list slot once ui-layout declares it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-terminal: dictionaries')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'terminal',
    locale: NS,
  }, TerminalPane))
}
