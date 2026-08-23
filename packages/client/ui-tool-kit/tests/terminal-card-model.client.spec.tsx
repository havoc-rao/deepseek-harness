// @vitest-environment jsdom
// The pure terminalCardModel derivation over callView/resultView — the source
// the chat bash row and the details panel both draw the terminal card from.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { terminalBlockLabels, terminalCardModel, terminalFailed } from '../src/client/models/terminal-card-model.ts'

const t = makeTranslate(zh, commonZh)

const ARGS = '{"command":"ls -la","description":"List files"}'

/** The bash tool's own call view for a foreground command. */
const callTerminal = (over?: Partial<Extract<ToolCallView, { card: 'terminal' }>>): ToolCallView => ({
  card: 'terminal', title: 'ls -la', description: 'List files', ...over,
})

/** The bash tool's own result view for a settled foreground command. */
const resultTerminal = (over?: Partial<Extract<ToolResultView, { card: 'terminal' }>>): ToolResultView => ({
  card: 'terminal', output: 'a.ts  b.ts\nc.ts  d.ts\n', exitCode: 0, ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'bash', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: callTerminal(), subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'bash', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'a.ts  b.ts\nc.ts  d.ts\n' }], isError: false,
  callView: callTerminal(), resultView: resultTerminal(), subCalls: [], ...over,
})

describe('terminalCardModel', () => {
  it('derives a running card from the call view alone', () => {
    expect(terminalCardModel(running({ callView: callTerminal({ cwd: '/projects/app' }) }))).toEqual({
      description: 'List files',
      card: {
        command: 'ls -la', cwd: '/projects/app', output: undefined,
        exitCode: undefined, signal: undefined, running: true,
      },
    })
  })

  it('derives a settled card from both sides, carrying the exit status', () => {
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '/projects/app' }),
      resultView: resultTerminal({ output: 'boom\n', exitCode: 2 }),
    }))).toEqual({
      description: 'List files',
      card: {
        command: 'ls -la', cwd: '/projects/app', output: 'boom\n',
        exitCode: 2, signal: undefined, running: false,
      },
    })
    expect(terminalCardModel(settled({
      resultView: { card: 'terminal', output: '', signal: 'SIGTERM' },
    }))?.card.signal).toBe('SIGTERM')
  })

  it('flags a failing exit as terminalFailed; clean exits and running cards are not', () => {
    // isError stays false on a failing command (the exit status is result
    // data), so this predicate is the row's only failure signal.
    expect(terminalFailed(terminalCardModel(settled({
      resultView: resultTerminal({ exitCode: 2 }),
    }))!)).toBe(true)
    expect(terminalFailed(terminalCardModel(settled({
      resultView: { card: 'terminal', output: '', signal: 'SIGTERM' },
    }))!)).toBe(true)
    expect(terminalFailed(terminalCardModel(settled())!)).toBe(false)
    expect(terminalFailed(terminalCardModel(running())!)).toBe(false)
  })

  it('takes the result view\'s replacement title over the pending one', () => {
    // The presentation contract defines a result title as REPLACING the pending
    // title, so a tool that rewrites it at settle time must win here.
    expect(terminalCardModel(settled({
      callView: callTerminal({ title: 'pnpm run check' }),
      resultView: resultTerminal({ title: 'pnpm run check --filter web' }),
    }))?.card.command).toBe('pnpm run check --filter web')
    // Without one, the call's title is what the card keeps.
    expect(terminalCardModel(settled())?.card.command).toBe('ls -la')
  })

  it('resolves the cwd against the session workspace the way the bridge must', () => {
    // Omitted workdir — the common bash call — IS the session workspace.
    expect(terminalCardModel(settled(), '/w/app')?.card.cwd).toBe('/w/app')
    // A relative workdir joins under it.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'packages/ui' }),
    }), '/w/app')?.card.cwd).toBe('/w/app/packages/ui')
    // An absolute one is used as-is.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '/srv/other' }),
    }), '/w/app')?.card.cwd).toBe('/srv/other')
    // With no session cwd there is nothing to resolve against: a relative path
    // stays as authored and an omitted one stays absent (a bare `$` prompt).
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'packages/ui' }),
    }))?.card.cwd).toBe('packages/ui')
    expect(terminalCardModel(settled())?.card.cwd).toBeUndefined()
    // The running arm resolves identically.
    expect(terminalCardModel(running(), '/w/app')?.card.cwd).toBe('/w/app')
  })

  it('normalizes a relative workdir so the label names the directory actually used', () => {
    // The bash executor resolves the workdir before running, so `..` against
    // /w/app runs in /w — the card must say `w`, not `..`.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..' }),
    }), '/w/app')?.card.cwd).toBe('/w')
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '.' }),
    }), '/w/app')?.card.cwd).toBe('/w/app')
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../sibling' }),
    }), '/w/app')?.card.cwd).toBe('/w/sibling')
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: './nested/../other' }),
    }), '/w/app')?.card.cwd).toBe('/w/app/other')
    // A `..` that would climb past the root is dropped, as a filesystem does.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../../..' }),
    }), '/w')?.card.cwd).toBe('/')
    // An absolute path carrying segments normalizes too.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '/srv/./app/../other' }),
    }), '/w/app')?.card.cwd).toBe('/srv/other')
    // A Windows path keeps its separators.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'C:\\ws\\app\\..' }),
    }), '/w')?.card.cwd).toBe('C:\\ws')
    // Without a session cwd a relative `..` has nothing to resolve against, so
    // it survives as authored rather than being silently dropped.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../elsewhere' }),
    }))?.card.cwd).toBe('../elsewhere')
  })

  it('keeps a UNC server and share as an unpoppable root', () => {
    // Windows cannot climb above a share, so `..` from the share root stays put.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..' }),
    }), '\\\\server\\share')?.card.cwd).toBe('\\\\server\\share')
    // Below the share it pops normally, keeping the UNC separators.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..' }),
    }), '\\\\server\\share\\app')?.card.cwd).toBe('\\\\server\\share')
    // Several `..` cannot escape the root either.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '../../..' }),
    }), '\\\\server\\share\\app')?.card.cwd).toBe('\\\\server\\share')
    // A `..` that leaves something under the share rebuilds the UNC path
    // with its backslash separators.
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: '..\\app' }),
    }), '\\\\server\\share')?.card.cwd).toBe('\\\\server\\share\\app')
  })

  it('normalizes a drive-relative Windows path under the drive letter', () => {
    expect(terminalCardModel(settled({
      callView: callTerminal({ cwd: 'C:ws\\..\\app' }),
    }))?.card.cwd).toBe('C:\\app')
  })

  it('draws a bare $ when the window dropped the call head, rather than guessing', () => {
    // A truncated call carries no cwd anywhere: the result view has none, and
    // the original call may have used an explicit workdir. Falling back to the
    // session workspace here would name a directory the card cannot know.
    expect(terminalCardModel(settled({
      call: null, callView: null, resultView: resultTerminal({ title: 'ls -la' }),
    }), '/w/app')?.card.cwd).toBeUndefined()
    // A present call view that omits its cwd still means the workspace.
    expect(terminalCardModel(settled(), '/w/app')?.card.cwd).toBe('/w/app')
  })

  it('carries the call view\'s description, which the contract renders above the card', () => {
    expect(terminalCardModel(settled())?.description).toBe('List files')
    expect(terminalCardModel(running())?.description).toBe('List files')
    // A presenter that supplies none, and a window-truncated call side, both
    // leave it absent so the row keeps its args-derived summary.
    expect(terminalCardModel(settled({
      callView: { card: 'terminal', title: 'ls' },
    }))?.description).toBeUndefined()
    expect(terminalCardModel(settled({ call: null, callView: null }))?.description).toBeUndefined()
  })

  it('a window-truncated call side falls back to the result title, then to an empty command', () => {
    // Truncation drops both the call head and its view (conversation.ts).
    const truncated = { call: null, callView: null }
    expect(terminalCardModel(settled({
      ...truncated, resultView: resultTerminal({ title: 'ls -la' }),
    }))?.card).toMatchObject({ command: 'ls -la', cwd: undefined, running: false })
    expect(terminalCardModel(settled(truncated))?.card).toMatchObject({ command: '', cwd: undefined })
  })

  it('returns null for every non-terminal call: no views, generic views, unknown cards', () => {
    expect(terminalCardModel(running({ callView: null }))).toBeNull()
    expect(terminalCardModel(settled({ callView: null, resultView: null }))).toBeNull()
    expect(terminalCardModel(running({ callView: { card: 'generic', title: 'read x' } }))).toBeNull()
    // A generic result settles a terminal call as a generic card (the bash
    // tool's own execution-error and background paths).
    expect(terminalCardModel(settled({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart', title: 'plot' } as unknown as ToolCallView
    expect(terminalCardModel(running({ callView: future }))).toBeNull()
    expect(terminalCardModel(settled({
      callView: future, resultView: { card: 'chart' } as unknown as ToolResultView,
    }))).toBeNull()
  })
})


describe('terminalBlockLabels', () => {
  it('binds the render-site locale seat, interpolating signal/code/counts', () => {
    const labels = terminalBlockLabels(t)
    expect(labels.signal('SIGTERM')).toContain('SIGTERM')
    expect(labels.exitCode(2)).toContain('2')
    expect(labels.expandAria(3)).toContain('3')
    expect(labels.expand(5)).toContain('5')
    // Static copy labels resolve through the seat and stay non-empty.
    expect(labels.running).toBeTruthy()
    expect(labels.failed).toBeTruthy()
    expect(labels.done).toBeTruthy()
    expect(labels.copy).toBeTruthy()
    expect(labels.copied).toBeTruthy()
    expect(labels.noOutput).toBeTruthy()
    expect(labels.collapseAria).toBeTruthy()
    expect(labels.collapse).toBeTruthy()
  })
})
