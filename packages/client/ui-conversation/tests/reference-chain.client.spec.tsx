// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { UserText } from '../src/client/skeleton/UserText.tsx'
import { UserText as SharedUserText, PlainUserText } from '../src/client/user-text/UserText.tsx'
import { UserTextRegistry } from '../src/client/conversation/user-text-registry.ts'
import { fileReferenceRule } from '../../ui-reference/src/client/user-text-rules.ts'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserTextInjected } from '../src/client/contract/slots.ts'

describe('user-text reference Factory', () => {
  let runtime: SlotTestRuntime | undefined
  afterEach(async () => { await runtime?.dispose() })
  it('shares plugin reference presentation across occurrences and restores fallback after disposal', async () => {
    runtime = await SlotTestRuntime.create()
    await runtime.sessions.add({ id: 'references' })
    const reference = runtime.sessions.retainFor(runtime.ctx, 'references' as SessionId)
    const registry = new UserTextRegistry(runtime.ctx)
    registry.register(fileReferenceRule)
    runtime.slots.registerFactory({
      name: 'conversation.user.text', scope: 'session',
      children: {
        'conversation.user.text.node': { kind: 'keyed', scope: 'session', inline: true },
        'conversation.message.reference': { kind: 'chain', scope: 'session' },
      },
      inject: (): UserTextInjected => ({
        hooks: { userTextRevision: {
          getSnapshot: () => registry.getSnapshot(), subscribe: listener => registry.subscribe(listener),
        } },
        createUserTextEvaluator: () => registry.createEvaluator(),
        reportTransformFailure: (error) => { throw error },
      }),
    }, SharedUserText)
    runtime.slots.register({ name: 'conversation.user.text.node', key: 'text' }, PlainUserText)
    runtime.slots.register({ name: 'conversation.user.text.node', key: 'file' },
      ({ node, raw }) => <ReferenceChip appearance="file" label={node.data.label} title={raw} />)
    const disposeFactory = runtime.slots.registerFactory({
      name: 'conversation.user-text', scope: 'session',
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
