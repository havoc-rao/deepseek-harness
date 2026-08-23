/**
 * Shared Tool-row presentation library, browser half. The module-table value
 * for `@deepseek-ai/dsh-client-ui-tool-kit/client`: the ToolRow chrome and the
 * pure row/card models that keyed `tool.call.toolview` registrants compose.
 * Consumers import values here (the sanctioned library route, unlike plugin
 * internals) and request the row through `dsh.client.external`.
 *
 * The package also carries an empty plugin entry so the roster adopts it like
 * every other dynamic row; the library surface is the product, `apply` is the
 * adoption seam. Export discipline: packages/client/AGENTS.md — only the row
 * surface, nothing ui-tool keeps private (the dispatch fallback, details
 * panel, and per-tool rows stay in `@deepseek-ai/dsh-client-ui-tool`).
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the conversation LocaleNamespaceMap merge the row seats
// type their `t` against (the namespace ui-conversation owns and registers),
// and the locale plugin's common vocabulary ('copy'/'copied'/'collapse').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

export { ToolRow } from './ToolRow.tsx'
export type { ToolRowProps } from './ToolRow.tsx'
export { classifyTool, resultText, toolRowModel } from './models/tool-call-model.ts'
export type { ToolCallBlock, ToolRowModel, ToolRowState, ToolRowVariant } from './models/tool-call-model.ts'
export { CHAT_DIFF_MAX_LINES, diffCardModel } from './models/diff-card-model.ts'
export type { DiffCardModel } from './models/diff-card-model.ts'
export { CHAT_READ_MAX_LINES, readCardModel } from './models/read-card-model.ts'
export type { ReadCardModel } from './models/read-card-model.ts'
export { CHAT_SEARCH_MAX_LINES, searchCardModel } from './models/search-card-model.ts'
export type { SearchCardModel } from './models/search-card-model.ts'
export { terminalBlockLabels, terminalCardModel, terminalFailed } from './models/terminal-card-model.ts'
export type { TerminalCardModel } from './models/terminal-card-model.ts'
export { webCardModel } from './models/web-card-model.ts'

/** Browser plugin body: the roster adopts this row; the library needs no wiring. */
export function apply(_ctx: Context): void {}
