// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { UserText } from '../src/client/skeleton/UserText.tsx'

describe('user-text reference Factory', () => {
  let runtime: SlotTestRuntime | undefined
  afterEach(async () => { await runtime?.dispose() })
  it('shares plugin reference presentation across occurrences and restores fallback after disposal', async () => {
    runtime = await SlotTestRuntime.create()
    await runtime.sessions.add({ id: 'references' })
    const reference = runtime.sessions.retainFor(runtime.ctx, 'references' as SessionId)
    const disposeFactory = runtime.slots.registerFactory({
      name: 'conversation.user-text', scope: 'session',
      children: { 'conversation.message.reference': { kind: 'chain', scope: 'session' } },
    }, UserText)
    const disposeReference = runtime.slots.register({
      name: 'conversation.message.reference',
      select: ({ token }) => token === '@external/opaque' ? 'Project title' : null,
    }, ({ matched }) => <strong>{matched}</strong>)
    await runtime.root.declare({ 'conversation.message.reference-test': { kind: 'single', scope: 'session' } },
      ({ SessionProvider, renderFactorySlot }) => <SessionProvider session={reference}>
        <div>{renderFactorySlot('conversation.user-text', { text: 'See @external/opaque, @notes.md' })}</div>
        <div>{renderFactorySlot('conversation.user-text', { text: '@external/opaque。' })}</div>
      </SessionProvider>)
    const view = runtime.renderRoot()
    expect(view.container.textContent).toBe('See Project title, notes.mdProject title。')
    await act(async () => { disposeReference() })
    expect(view.container.textContent).toBe('See opaque, notes.mdopaque。')
    await act(async () => { disposeFactory() })
    expect(view.container.textContent).toBe('')
  })
})

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.message.reference-test': { kind: 'single'; scope: 'session' }
  }
}
