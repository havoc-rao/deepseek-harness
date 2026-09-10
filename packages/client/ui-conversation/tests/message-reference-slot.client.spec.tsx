// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ChatNodeViewProps, MessageReferenceOwnerProps } from '../src/client/contract/slots.ts'
import { UserMessageNodeView, PendingSteeringBubble } from '../src/client/chat/MessageItem.tsx'
afterEach(cleanup)
const t = ((key: string) => key) as ChatNodeViewProps['t']
const text = '请 @workspace-id/stable-id 执行任务'
const node = { data: { content: [{ type: 'text', text }], time: Date.now() } } as ChatNodeViewProps<'user'>['node']
it('routes references through the extension while retaining surrounding text', () => {
  const renderMessageReference = vi.fn((_owner: MessageReferenceOwnerProps) => <span data-ref-chip="workspace">项目名称</span>)
  render(<UserMessageNodeView {...{ node, t, renderMessageReference, renderMessageImages: () => null } as ChatNodeViewProps<'user'>} />)
  expect(screen.getByText('项目名称')).toBeTruthy()
  expect(renderMessageReference).toHaveBeenCalledWith(expect.objectContaining({ token: '@workspace-id/stable-id' }))
  expect(document.body.textContent).toContain('执行任务')
  expect(node.data.content).toEqual([{ type: 'text', text }])
})
it('keeps the official chip when no extension renderer is provided', () => {
  render(<UserMessageNodeView {...{ node, t, renderMessageImages: () => null } as ChatNodeViewProps<'user'>} />)
  expect(screen.getByText('stable-id').getAttribute('data-ref-chip')).toBe('file')
})
it('uses the same reference slot for pending steering messages', () => {
  render(
    <PendingSteeringBubble
      content={node.data.content}
      t={t}
      renderMessageImages={() => null}
      renderMessageReference={() => <span>项目名称</span>}
    />,
  )
  expect(screen.getByText('项目名称')).toBeTruthy()
})
