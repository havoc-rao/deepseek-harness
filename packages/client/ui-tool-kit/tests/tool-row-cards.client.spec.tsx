// @vitest-environment jsdom
// ToolRow's card-material branches: each card kind renders through its
// primitive in the expanded body, the code variant draws the program through
// CodeBlock, and a capped search card carries its recovery footer below the
// card. The model derivations themselves are pinned by the card-model specs;
// this suite feeds the models' products straight into the row.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import type { WebBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolRow, type ToolRowProps } from '../src/client/ToolRow.tsx'
import type { DiffCardModel } from '../src/client/models/diff-card-model.ts'
import type { ReadCardModel } from '../src/client/models/read-card-model.ts'
import type { SearchCardModel } from '../src/client/models/search-card-model.ts'
import type { TerminalCardModel } from '../src/client/models/terminal-card-model.ts'

afterEach(cleanup)

const t: ToolRowProps['t'] = makeTranslate(zh, commonZh)

const base = { t, icon: <i data-testid="tool-icon" />, title: 'Bash', summary: 'List files', state: 'ok' as const }

const toggle = (view: { container: HTMLElement }) => {
  fireEvent.click(view.container.querySelector('[data-expandable]')!)
}

describe('ToolRow card bodies', () => {
  it('terminal card renders the command output in the expanded body', () => {
    const terminal: TerminalCardModel = {
      description: 'List files',
      card: { command: 'ls -la', cwd: '/w/app', output: 'a.ts\nb.ts\n', exitCode: 0, signal: undefined, running: false },
    }
    const view = render(<ToolRow {...base} variant="bash" body={null} terminal={terminal} />)
    toggle(view)
    expect(view.container.querySelector('[data-terminal]')).not.toBeNull()
    expect(view.getByText('a.ts')).toBeTruthy()
  })

  it('diff card renders the applied change in the expanded body', () => {
    const diff: DiffCardModel = {
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }] },
    }
    const view = render(<ToolRow {...base} variant="edit" title="Edit" summary="notes/demo.txt" body={null} diff={diff} />)
    toggle(view)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(view.getByText('hello fixture')).toBeTruthy()
  })

  it('read card renders the windowed file in the expanded body', () => {
    const read: ReadCardModel = {
      label: 'src/a.ts', totalLines: 3, lang: 'ts',
      lines: [
        { number: 41, text: 'export const a = 1' },
        { number: 42, text: 'export const b = 2' },
      ],
    }
    const view = render(<ToolRow {...base} variant="read" title="Read" summary="src/a.ts" body={null} read={read} />)
    toggle(view)
    expect(view.container.querySelector('[data-read]')).not.toBeNull()
    // Highlighting splits a line across token spans; read the content cells.
    const cells = [...view.container.querySelectorAll('[data-read] [class^="_content_"]')]
      .map(cell => cell.textContent ?? '')
    expect(cells.join('\n')).toContain('export const a = 1')
  })

  it('search card renders grouped matches, with the recovery footer below a capped card', () => {
    const search: SearchCardModel = {
      title: undefined,
      recovery: 'Full grep result stored at: fixture://spill/grep-66.',
      card: {
        kind: 'matches',
        files: [{ path: 'a.ts', matches: [{ lineNumber: 12, line: 'const foo = 1' }] }],
        truncated: true,
        total: 3,
      },
    }
    const view = render(<ToolRow {...base} variant="search" title="Search" summary="foo" body={null} search={search} />)
    toggle(view)
    expect(view.container.querySelector('[data-search]')).not.toBeNull()
    expect(view.getByText('const foo = 1')).toBeTruthy()
    expect(view.getByText('Full grep result stored at: fixture://spill/grep-66.')).toBeTruthy()
  })

  it('web card renders the citation list in the expanded body', () => {
    const web: WebBlockProps = {
      kind: 'search', truncated: false, answer: 'A short answer.',
      sources: [{ url: 'https://example.com/a', title: 'Titled', snippet: 'excerpt', publishedAt: '2026-07-01' }],
    }
    const view = render(<ToolRow {...base} variant="search" title="Search" summary="deepseek harness" body={null} web={web} />)
    toggle(view)
    expect(view.container.querySelector('[data-web]')).not.toBeNull()
    expect(view.getByText('Titled')).toBeTruthy()
    expect(view.getByText('excerpt')).toBeTruthy()
  })

  it('the code variant draws the program through CodeBlock, not the IN/OUT card', () => {
    const view = render(
      <ToolRow {...base} variant="code" title="Code" summary="run_code" body={'const x = 1'} output="42" />,
    )
    toggle(view)
    expect(view.container.querySelector('pre')?.textContent).toContain('const x = 1')
    expect(view.queryByText('IN')).toBeNull()
    // The output still joins the card below the program.
    expect(view.getByText('42')).toBeTruthy()
  })
})
