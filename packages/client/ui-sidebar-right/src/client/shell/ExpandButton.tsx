/**
 * Persistent right-Sidebar toggle in the conversation header's corner seat.
 * Shares the panel's per-session store and remains mounted across expansion
 * changes so keyboard focus stays on the control.
 */
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactNode } from 'react'
import { Button, IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { createSidebarRightStore } from '../stores.ts'
import css from './ExpandButton.module.css'

/** The button's props: the header corner seat, the shared store, and copy. */
export type ExpandButtonProps =
  & PropsRuntime<'conversation.session.header.corner'>
  & PropsStore<ReturnType<typeof createSidebarRightStore>>
  & PropsLocale<'sidebarRight'>
  & InjectFace<{ hooks: { shortcuts: HostObservable<readonly ShortcutCatalogEntry[]> } }>

/** Toggle the panel with state-dependent labels and an accessible expansion state. */
export function ExpandButton({ sessionId, useStore, actions, t, useShortcuts }: ExpandButtonProps): ReactNode {
  // A session with no surface yet is collapsed: the panel seat materializes the
  // surface on its own mount, and until then there is nothing expanded.
  const shortcut = useShortcuts(entries => entries.find(entry => entry.id === 'sidebar.right.toggle'))
  const expanded = useStore(state => state.bySession[sessionId]?.layout.expanded ?? false)
  return (
    <Tooltip label={t(expanded ? 'chrome.collapse' : 'chrome.expand')} shortcutKeys={shortcut?.keys} side="bottom" delayMs={500}>
      <Button
        size="sm"
        className={css.button}
        aria-label={t(expanded ? 'chrome.collapseAria' : 'chrome.expandAria')}
        aria-expanded={expanded}
        aria-keyshortcuts={shortcut?.aria}
        data-sidebar-right-expand
        onClick={() => { actions.toggleExpanded(sessionId) }}
      >
        <IconPanelLeftOutlineRegular className={css.icon} />
      </Button>
    </Tooltip>
  )
}
