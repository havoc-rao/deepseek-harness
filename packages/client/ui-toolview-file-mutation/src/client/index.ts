/**
 * File-mutation toolview plugin, browser half: registers the `edit` and `write`
 * rows into the keyed `tool.call.toolview` slot the ui-tool call tree declares.
 * A keyed hit replaces the generic fallback, so this plugin owns how every
 * file-mutation call renders — the applied diff card plus the trailing +A -R
 * totals suffix. The row composes the shared ToolRow and row/card models from
 * the ui-tool-kit (a module-table library, requested through
 * `dsh.client.external`); the locale seat is the conversation namespace
 * ui-conversation owns, so the plugin registers no dictionaries of its own.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation LocaleNamespaceMap merge and the locale
// plugin's ctx merge (the row's `t` seat and the register `locale` field).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FileMutationRow } from './FileMutationRow.tsx'

/** The conversation locale namespace ui-conversation owns (ui-tool's CONVERSATION_NS). */
const NS = 'conversation'

/** Required services: the slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: register the file-mutation row under both mutation tool
 * names, through the declared slot so the contribution rides the declaration's
 * lifetime and rolls back atomically on teardown.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, FileMutationRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, FileMutationRow)
  })
}
