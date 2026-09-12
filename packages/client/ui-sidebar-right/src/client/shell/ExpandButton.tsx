/**
 * The way into a hidden panel: one button in the conversation header's corner
 * seat, shown only while the panel is collapsed.
 *
 * It lives in the conversation's own header rather than in the frame's right
 * column so that a collapsed Sidebar costs the conversation nothing — no rail,
 * no width, and the transcript's scrollbar stays at the column's edge. The
 * corner seat is its own, past the utilities' edge, so the button never joins
 * the utilities row; while the panel is shown this renders nothing, and the
 * seat collapses with it. It shares the panel's session-maybe store, which the
 * slot runtime allows because every seat sharing the handle is session-maybe.
 *
 * The glyph is the left sidebar's collapse icon mirrored: the same affordance,
 * on the other edge.
 *
 * The same control opens the panel while no Session is current. Its seat is
 * session-maybe, so `sessionId` is absent exactly then, and the read and the
 * write fall back to the session-independent surface key — the seat that is
 * mounted is the panel's own, expanded or not.
 */
import type { ReactNode } from 'react'
import { IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { GLOBAL_SURFACE_KEY, type createSidebarRightStore } from '../stores.ts'
import css from './ExpandButton.module.css'

/** The button's props: the header corner seat, the shared store, and copy. */
export type ExpandButtonProps =
  & PropsRuntime<'conversation.session.header.corner'>
  & PropsStore<ReturnType<typeof createSidebarRightStore>>
  & PropsLocale<'sidebarRight'>

/** The expand control while the panel is collapsed; nothing while it is shown. */
export function ExpandButton({ sessionId, useStore, actions, t }: ExpandButtonProps): ReactNode {
  // A session with no surface yet is collapsed: the panel seat materializes the
  // surface on its own mount, and until then there is nothing expanded. No
  // session at all addresses the session-independent surface.
  const surfaceKey = sessionId ?? GLOBAL_SURFACE_KEY
  const expanded = useStore(state => state.bySession[surfaceKey]?.layout.expanded ?? false)
  if (expanded) return null
  return (
    <Tooltip label={t('chrome.expand')} side="bottom" delayMs={500}>
      <button
        type="button"
        className={css.button}
        aria-label={t('chrome.expandAria')}
        data-sidebar-right-expand
        onClick={() => { actions.setExpanded(surfaceKey, true) }}
      >
        <IconPanelLeftOutline16 className={css.icon} />
      </button>
    </Tooltip>
  )
}

/** The hero corner seat's props: the same store share and copy as the header's. */
export type HeroExpandButtonProps =
  & PropsRuntime<'conversation.hero.corner'>
  & PropsStore<ReturnType<typeof createSidebarRightStore>>
  & PropsLocale<'sidebarRight'>

/**
 * The hero's corner variant of {@link ExpandButton}: rendered only while no
 * Session is current — once one exists the header's corner seat provides the
 * button — and otherwise the same control, addressing the session-independent
 * surface through the shared store.
 */
export function HeroExpandButton({ sessionId, ...button }: HeroExpandButtonProps): ReactNode {
  if (sessionId !== undefined) return null
  return <ExpandButton sessionId={undefined} {...button} />
}
