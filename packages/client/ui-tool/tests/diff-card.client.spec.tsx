// @vitest-environment jsdom
// The diff render intent on the web side, core surfaces: the chat tool row's
// expanded body through the GenericToolCard fallback and the details panel's
// Output section. The pure diffCardModel derivation and the keyed
// edit/write FileMutationRow live in the ui-tool-kit and
// ui-toolview-file-mutation packages respectively.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SelectionTarget } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CHAT_DIFF_MAX_LINES } from '@deepseek-ai/dsh-client-ui-tool-kit/client'
import { createChatStore } from '@deepseek-ai/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { DetailsPanel } from '@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/DetailsPanel.tsx'
import { renderToolDetails, SessionProviderStub, toolChatSnapshot } from './tool-details-render.client.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const SID = 's1' as SessionId

const t = makeTranslate(zh, commonZh)

const ARGS = '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}'

/** The edit tool's own call view (a call-time diff derived from the arguments). */
const callDiff = (over?: Partial<Extract<ToolCallView, { card: 'diff' }>>): ToolCallView => ({
  card: 'diff', title: 'Edit notes/demo.txt',
  diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }], ...over,
})

/** The edit tool's own result view (the applied hunk diff). */
const resultDiff = (over?: Partial<Extract<ToolResultView, { card: 'diff' }>>): ToolResultView => ({
  card: 'diff', title: 'Edit notes/demo.txt',
  diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }], ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'edit', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: callDiff(), subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'edit', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'The file notes/demo.txt has been updated successfully.' }], isError: false,
  callView: callDiff(), resultView: resultDiff(), subCalls: [], ...over,
})

describe('chat row diff body', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode): GenericToolCardProps => ({
    callId: 'c1', toolName: 'edit', block, openFile: vi.fn(), t,
  })

  it('the expanded body is the applied diff, capped tighter than the panel', () => {
    expect(CHAT_DIFF_MAX_LINES).toBeLessThan(16)
    const view = render(<GenericToolCard {...ownerProps(settled())} />)
    // Collapsed: the summary row (path) only, no diff body.
    expect(view.queryByText('hello fixture')).toBeNull()
    // The path link is not the expand control; the leading toggle is.
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(view.getByText('hello fixture')).toBeTruthy()
  })

  it('a running diff call expands to its intended change', () => {
    const view = render(<GenericToolCard {...ownerProps(running())} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
  })

  it('a non-diff call keeps the args-JSON text body', () => {
    // A non-file tool name so the row is not single-file (no path link), and its
    // args body is the fallback the diff card must not have replaced.
    const view = render(<GenericToolCard {...{
      callId: 'c1', toolName: 'some_tool', openFile: vi.fn(), t,
      block: settled({
        call: { name: 'some_tool', argsRaw: '{"foo":"bar"}' },
        callView: null, resultView: null,
      }),
    }} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.getByText(/"foo"/)).toBeTruthy()
  })
})

describe('DetailsPanel diff Output section', () => {
  function mount(snapshot: ConversationSnapshot, selection: SelectionTarget | null, cwd?: string) {
    localStorage.clear()
    const chat = createChatStore().create()
    if (selection !== null) chat.actions.select(selection)
    const sessions = createSnapshotStore<SessionListState>(cwd === undefined
      ? { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }
      : {
        ids: [SID],
        byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd } },
        current: SID,
        phase: 'ready',
        subagentsByParent: {}, jobsBySession: {},
        currentAddress: undefined,
      })
    const workspaces = createSnapshotStore<WorkspaceListState>({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })
    return render(
      <DetailsPanel
        SessionProvider={SessionProviderStub}
        renderSlot={renderToolDetails(t)}
        sessionId={SID}
        useSession={bindSnapshotSelector({ getSnapshot: () => snapshot, subscribe: () => () => {} })}
        useSessions={bindSnapshotSelector(sessions)}
        useWorkspaces={bindSnapshotSelector(workspaces)}
        useInput={(() => { throw new Error('unused') })}
        inputActions={{
          setDraft: () => {},
          addImages: () => true,
          removeImage: () => {},
          pruneImages: () => {},
          submit: () => {},
        }}
        useProjection={(() => undefined)}
        useStore={bindSnapshotSelector(chat)}
        actions={chat.actions}
        closeDetails={vi.fn()}
        t={t}
      />,
    )
  }

  function snapshot(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
    const nodes = over.nodes ?? []
    const runningCalls = over.runningCalls ?? []
    return {
      sessionId: SID, views: EMPTY_CONVERSATION_VIEWS,
      chat: over.chat ?? toolChatSnapshot(nodes, runningCalls),
      nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
      openState: 'open', openError: null, hasMore: false, loadingOlder: false,
      promptError: null, blank: false, subagent: null, lastAgentError: null, ...over,
    }
  }

  const target: SelectionTarget = { turnSeq: 10, callId: 'c1', toolName: 'edit' }

  it('renders the applied diff at full height, keeping the JSON Input section', () => {
    const view = mount(snapshot({ nodes: [settled()] }), target)
    expect(view.getByText(/"file_path"/)).toBeTruthy()
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(view.getByText('hello fixture')).toBeTruthy()
  })

  it('a running diff call renders its intended change, not the 运行中… placeholder', () => {
    const view = mount(snapshot({ runningCalls: [running()] }), target)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(view.queryByText('运行中…')).toBeNull()
  })

  it('a non-diff result keeps the flattened pre', () => {
    const view = mount(snapshot({
      nodes: [settled({
        callView: null, resultView: null,
        content: [{ type: 'text', text: 'permission denied' }],
      })],
    }), target)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.getByText('输出').closest('section')?.querySelector('pre')?.textContent).toBe('permission denied')
  })
})
