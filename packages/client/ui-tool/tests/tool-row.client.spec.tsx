// @vitest-environment jsdom
// The GenericToolCard dispatch fallback: classifies any unregistered tool name
// into a variant row and drives the shared ToolRow chrome (from the
// ui-tool-kit) with the owner payload. The row kit's own model/ToolRow
// contracts live in the ui-tool-kit package's specs.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(() => {
  cleanup()
})

// Mirrors the real lookup chain (conversation namespace, then common).
const t: GenericToolCardProps['t'] = makeTranslate(zh, commonZh)

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'bash', argsRaw: '{"command":"ls -la","description":"List files"}',
  turn: 1, step: 1, time: 1_000, callView: null, subCalls: [], ...over,
})

const result = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'bash', argsRaw: '{"command":"ls -la","description":"List files"}' },
  callTime: 1_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [], ...over,
})

describe('GenericToolCard', () => {
  const props = (toolName: string, block: RunningToolCall | ToolResultNode): GenericToolCardProps => ({
    callId: 'c1', toolName, block, openFile: vi.fn(), t,
  })

  it('renders the classified variant row from the frozen slice', () => {
    const view = render(<GenericToolCard {...props('bash', result())} />)
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('List files')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="bash"]')).not.toBeNull()
  })

  it('unknown tools land on the others variant titled Tool call', () => {
    const view = render(
      <GenericToolCard {...props('todo_write', running({ name: 'todo_write', argsRaw: '{"note":"x"}' }))} />,
    )
    expect(view.getByText('Tool call')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.container.querySelector('[data-state="running"]')).not.toBeNull()
  })

  it('renders edit with its dedicated title, icon variant, and path summary', () => {
    const view = render(
      <GenericToolCard {...props('edit', running({
        name: 'edit',
        argsRaw: '{"file_path":"src/x.ts","old_string":"before","new_string":"after"}',
      }))} />,
    )
    expect(view.getByText('Edit')).toBeTruthy()
    expect(view.getByText('src/x.ts')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="edit"]')).not.toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()
  })

  it('renders write with its dedicated title, icon variant, and path summary', () => {
    const view = render(
      <GenericToolCard {...props('write', running({
        name: 'write',
        argsRaw: '{"file_path":"src/x.ts","content":"hello"}',
      }))} />,
    )
    expect(view.getByText('Write')).toBeTruthy()
    expect(view.getByText('src/x.ts')).toBeTruthy()
    expect(view.container.querySelector('[data-variant="write"]')).not.toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()
  })

  it('passes the owner inspect callback through to the expanded row pill', () => {
    const inspect = vi.fn()
    const view = render(<GenericToolCard {...props('bash', result())} inspect={inspect} />)
    fireEvent.click(view.getByRole('button', { name: /Bash/ }))
    fireEvent.click(view.getByText('Inspect'))
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('file-path summary click reaches openFile; bash summary does not', () => {
    const file = props('read', running({ name: 'read', argsRaw: '{"path":"src/x.ts"}' }))
    const fileView = render(<GenericToolCard {...file} />)
    fireEvent.click(fileView.getByText('src/x.ts'))
    expect(file.openFile).toHaveBeenCalledWith('src/x.ts')

    const bash = props('bash', result())
    const bashView = render(<GenericToolCard {...bash} />)
    fireEvent.click(bashView.getByText('List files'))
    expect(bash.openFile).not.toHaveBeenCalled()
  })
})
