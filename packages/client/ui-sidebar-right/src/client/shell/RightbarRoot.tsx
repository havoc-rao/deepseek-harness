/** Root-scoped controller for the right Sidebar's content. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contract/slots.ts'

/**
 * Render the Sidebar only while the Conversation is selected. The seat itself
 * is session-maybe: with a Session current it draws that Session's surface,
 * without one it draws the session-independent surface, both inside the
 * frame's right column.
 * @param props - frame geometry, panel selection, and the Session-bound renderer.
 * @returns the current Session's right Sidebar, or the session-independent one, or no content for a global panel.
 */
export function RightbarRoot({
  usePanelInfo, renderSlot, width, viewportWidth, canShow,
}: PropsRuntime<'rightbar'> & PropsRenderSlots<'rightbar.session'>) {
  const visible = usePanelInfo(info => info.activePanelId === null)
  if (!visible) return null
  return renderSlot('rightbar.session', { width, viewportWidth, canShow })
}
