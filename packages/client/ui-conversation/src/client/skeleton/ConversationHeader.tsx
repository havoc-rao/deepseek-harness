/** Resident conversation navigation and Session-specific header content. */
import clsx from 'clsx'
import { useLayoutEffect } from 'react'
import type { ConversationHeaderProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import css from './ConversationRoot.module.css'

/**
 * Keeps global navigation available before a Session exists.
 * @param props - Optional Session sources and authorized header slots.
 * @returns The persistent header with any selected Session's title and views.
 */
export function ConversationHeader({ sessionId, useSession, useConversation, renderSlot, reportHeader }: ConversationHeaderProps) {
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const phase = session === undefined || conversation === undefined
    ? undefined : conversationPhase(session, conversation)
  const blank = session === undefined || phase === undefined || (session.blank && phase === 'blank')
  const cornerAvailable = sessionId !== undefined
  const chromeVisible = cornerAvailable && !blank
  useLayoutEffect(() => {
    reportHeader({ sessionId, phase, chromeVisible, cornerAvailable })
  }, [reportHeader, sessionId, phase, chromeVisible, cornerAvailable])
  useLayoutEffect(() => () => { reportHeader(undefined) }, [reportHeader])
  return (
    <header className={clsx(css.header, blank && css.headerBlank, sessionId === undefined && css.headerSessionless)} data-window-drag>
      <div className={css.headerLeading} data-conversation-header-leading="">
        {renderSlot('conversation.header.leading', {})}
      </div>
      {sessionId === undefined
        ? <div className={css.titleRow} />
        : renderSlot('conversation.session.header', { hideChrome: blank })}
    </header>
  )
}
