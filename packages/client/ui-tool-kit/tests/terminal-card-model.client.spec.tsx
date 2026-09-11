// @vitest-environment jsdom
// The pure terminalCardModel derivation: standard-shell and terminal_send
// cards off raw call arguments and settled content, workdir resolution, and
// the render-site locale binding for terminal_send copy.

import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  localizeTerminalCardModel, terminalCardModel, terminalFailed,
} from '../src/client/models/terminal-card-model.ts'
import { en, zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

const t = makeTranslate(zh, commonZh)
const enT = makeTranslate(en, commonEn)

const ARGS = '{"command":"ls -la","description":"List files"}'

const shellArgs = (over: Record<string, unknown> = {}): string => JSON.stringify({
  command: 'ls -la', description: 'List files', ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'bash', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'bash', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'a.ts  b.ts\nc.ts  d.ts\n' }], isError: false,
  subCalls: [], ...over,
})

describe('terminalCardModel', () => {
  it('derives a running standard-shell card from raw arguments', () => {
    expect(terminalCardModel(running({ argsRaw: shellArgs({ workdir: '/projects/app' }) }))).toEqual({
      copy: { kind: 'shell', command: 'ls -la', description: 'List files' },
      card: {
        cwd: '/projects/app', output: undefined,
        exitCode: undefined, signal: undefined, running: true,
      },
    })
  })

  it('derives a settled standard-shell card and removes its final exit marker', () => {
    expect(terminalCardModel(settled({
      call: { name: 'bash', argsRaw: shellArgs({ workdir: '/projects/app' }) },
      content: [{ type: 'text', text: 'boom\n[exit code: 2]' }],
    }))).toEqual({
      copy: { kind: 'shell', command: 'ls -la', description: 'List files' },
      card: {
        cwd: '/projects/app', output: 'boom',
        exitCode: 2, signal: undefined, running: false,
      },
    })
    expect(terminalCardModel(settled({
      content: [{ type: 'text', text: 'gone\n[killed by signal: SIGTERM]' }],
    }))?.card).toMatchObject({ output: 'gone', signal: 'SIGTERM' })
  })

  it('flags a failing exit as terminalFailed; clean exits and running cards are not', () => {
    // isError stays false on a failing command (the exit status is result
    // data), so this predicate is the row's only failure signal.
    expect(terminalFailed(terminalCardModel(settled({
      content: [{ type: 'text', text: 'boom\n[exit code: 2]' }],
    }))!)).toBe(true)
    expect(terminalFailed(terminalCardModel(settled({
      content: [{ type: 'text', text: 'gone\n[killed by signal: SIGTERM]' }],
    }))!)).toBe(true)
    expect(terminalFailed(terminalCardModel(settled())!)).toBe(false)
    expect(terminalFailed(terminalCardModel(running())!)).toBe(false)
  })

  it('keeps status text that has no terminal pill and requires a leading newline', () => {
    expect(terminalCardModel(settled({
      content: [{ type: 'text', text: 'timed out\n[timed out after 1000ms]\n[exit code: 2]' }],
    }))?.card).toMatchObject({ output: 'timed out\n[timed out after 1000ms]', exitCode: 2 })
    expect(terminalCardModel(settled({
      content: [{ type: 'text', text: '[exit code: 5]' }],
    }))?.card).toMatchObject({ output: '[exit code: 5]', exitCode: 0 })
  })

  it('resolves the raw workdir against the session workspace', () => {
    // Omitted workdir — the common bash call — IS the session workspace.
    expect(terminalCardModel(settled(), '/w/app')?.card.cwd).toBe('/w/app')
    // A relative workdir joins under it.
    expect(terminalCardModel(settled({
      call: { name: 'bash', argsRaw: shellArgs({ workdir: 'packages/ui' }) },
    }), '/w/app')?.card.cwd).toBe('/w/app/packages/ui')
    // An absolute one is used as-is.
    expect(terminalCardModel(settled({
      call: { name: 'bash', argsRaw: shellArgs({ workdir: '/srv/other' }) },
    }), '/w/app')?.card.cwd).toBe('/srv/other')
    // With no session cwd there is nothing to resolve against: a relative path
    // stays as authored and an omitted one stays absent (a bare `$` prompt).
    expect(terminalCardModel(settled({
      call: { name: 'bash', argsRaw: shellArgs({ workdir: 'packages/ui' }) },
    }))?.card.cwd).toBe('packages/ui')
    expect(terminalCardModel(settled())?.card.cwd).toBeUndefined()
    // The running arm resolves identically.
    expect(terminalCardModel(running(), '/w/app')?.card.cwd).toBe('/w/app')
  })

  it('normalizes a relative workdir so the label names the directory actually used', () => {
    // The bash executor resolves the workdir before running, so `..` against
    // /w/app runs in /w — the card must say `w`, not `..`.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '..' }) } }), '/w/app')?.card.cwd).toBe('/w')
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '.' }) } }), '/w/app')?.card.cwd).toBe('/w/app')
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '../sibling' }) } }), '/w/app')?.card.cwd).toBe('/w/sibling')
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: './nested/../other' }) } }), '/w/app')?.card.cwd).toBe('/w/app/other')
    // A `..` that would climb past the root is dropped, as a filesystem does.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '../../..' }) } }), '/w')?.card.cwd).toBe('/')
    // An absolute path carrying segments normalizes too.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '/srv/./app/../other' }) } }), '/w/app')?.card.cwd).toBe('/srv/other')
    // A Windows path keeps its separators.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: 'C:\\ws\\app\\..' }) } }), '/w')?.card.cwd).toBe('C:\\ws')
    // Without a session cwd a relative `..` has nothing to resolve against, so
    // it survives as authored rather than being silently dropped.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '../elsewhere' }) } }))?.card.cwd).toBe('../elsewhere')
  })

  it('keeps a UNC server and share as an unpoppable root', () => {
    // Windows cannot climb above a share, so `..` from the share root stays put.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '..' }) } }), '\\\\server\\share')?.card.cwd).toBe('\\\\server\\share')
    // Below the share it pops normally, keeping the UNC separators.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '..' }) } }), '\\\\server\\share\\app')?.card.cwd).toBe('\\\\server\\share')
    // Several `..` cannot escape the root either.
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: shellArgs({ workdir: '../../..' }) } }), '\\\\server\\share\\app')?.card.cwd).toBe('\\\\server\\share')
  })

  it('supports terminal_send without giving background or failed sends a terminal card', () => {
    const argsRaw = JSON.stringify({ sessionId: 'pty-3', text: 'make' })
    const run = running({ name: 'terminal_send', argsRaw })
    expect(terminalCardModel(run, '/w/app')).toMatchObject({
      copy: { kind: 'terminal-send', text: 'make', sessionId: 'pty-3' },
      card: { cwd: '/w/app', running: true },
    })
    const done = settled({ call: { name: 'terminal_send', argsRaw }, content: [{ type: 'text', text: 'ok' }] })
    expect(localizeTerminalCardModel(terminalCardModel(done)!, enT)).toMatchObject({
      description: 'Terminal pty-3', card: { command: 'make', output: 'ok', running: false },
    })
    expect(terminalCardModel(settled({
      call: { name: 'terminal_send', argsRaw: JSON.stringify({ sessionId: 'pty-3', text: 'make', run_in_background: true }) },
    }))).toBeNull()
    expect(terminalCardModel(settled({ ...done, isError: true }))).toBeNull()
  })

  it('preserves persistent-shell running cards and settled generic output', () => {
    const persistent = JSON.stringify({ command: 'pwd' })
    expect(terminalCardModel(running({ argsRaw: persistent }))).toMatchObject({
      copy: { kind: 'shell', command: 'pwd', description: undefined }, card: { running: true },
    })
    expect(terminalCardModel(running({ name: 'pwsh', argsRaw: persistent }))).toMatchObject({
      copy: { kind: 'shell', command: 'pwd', description: undefined }, card: { running: true },
    })
    expect(terminalCardModel(settled({ call: { name: 'bash', argsRaw: persistent } }))).toBeNull()
    expect(terminalCardModel(settled({ call: { name: 'pwsh', argsRaw: persistent } }))).toBeNull()
  })

  it('derives the standard pwsh card from the same raw status markers', () => {
    expect(terminalCardModel(settled({
      call: { name: 'pwsh', argsRaw: ARGS },
      content: [{ type: 'text', text: 'failed\n[exit code: 3]' }],
    }))).toMatchObject({
      copy: { kind: 'shell', command: 'ls -la', description: 'List files' },
      card: { output: 'failed', exitCode: 3, running: false },
    })
  })

  it('keeps terminal_send copy semantic until the render locale is known', () => {
    const model = terminalCardModel(running({
      name: 'terminal_send',
      argsRaw: JSON.stringify({ sessionId: 'pty-3', text: '' }),
    }))!
    expect(model.copy).toEqual({ kind: 'terminal-send', text: '', sessionId: 'pty-3' })
    expect(localizeTerminalCardModel(model, t)).toMatchObject({
      description: '终端 pty-3', card: { command: '（发送输入）' },
    })
    expect(localizeTerminalCardModel(model, enT)).toMatchObject({
      description: 'Terminal pty-3', card: { command: '(send input)' },
    })
  })

  it('returns null without a paired call', () => {
    expect(terminalCardModel(settled({ call: null }))).toBeNull()
  })

  it('derives the same terminal card for root calls and Code Dispatch children', () => {
    expect(terminalCardModel(settled({ parentCallId: 'parent' }))).toEqual(terminalCardModel(settled()))
    expect(terminalCardModel(running({ parentCallId: 'parent' }))).toEqual(terminalCardModel(running()))
  })

  it.each(['bash', 'pwsh'])('keeps nested persistent %s running cards and settled generic results', (name) => {
    const argsRaw = JSON.stringify({ command: 'pwd' })
    expect(terminalCardModel(running({ name, argsRaw, parentCallId: 'parent' })))
      .toEqual(terminalCardModel(running({ name, argsRaw })))
    expect(terminalCardModel(settled({ call: { name, argsRaw }, parentCallId: 'parent' }))).toBeNull()
  })

  it.each(['bash', 'pwsh'])('does not infer %s exit status from a spilled preview', (name) => {
    const notice = '(Omitted 50000 bytes. Full formatted result stored at: /spill/output.txt. Read the file.)'
    for (const parentCallId of [undefined, 'parent']) {
      for (const preview of ['failed\n[exit code: 7]', 'killed\n[killed by signal: SIGTERM]', 'partial', '']) {
        expect(terminalCardModel(settled({
          ...parentCallId === undefined ? {} : { parentCallId },
          call: { name, argsRaw: ARGS },
          content: [{ type: 'text', text: preview === '' ? notice : `${preview}\n\n${notice}` }],
        }))).toBeNull()
      }
    }
    expect(terminalCardModel(settled({
      call: { name, argsRaw: ARGS },
      content: [{ type: 'text', text: `${notice}\nordinary output` }],
    }))).not.toBeNull()
  })

  it('returns null for background, errors, malformed args, unsupported tools, and non-text results', () => {
    expect(terminalCardModel(running({ argsRaw: shellArgs({ run_in_background: true }) }))).toBeNull()
    expect(terminalCardModel(settled({ isError: true }))).toBeNull()
    expect(terminalCardModel(running({ argsRaw: '{' }))).toBeNull()
    expect(terminalCardModel(running({ name: 'read' }))).toBeNull()
    expect(terminalCardModel(settled({ content: [] }))).toBeNull()
    expect(terminalCardModel(settled({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))).toBeNull()
  })

  it.each([
    ['timeout type', { timeoutMs: '1000' }],
    ['timeout value', { timeoutMs: 0 }],
    ['workdir type', { workdir: 7 }],
    ['background type', { run_in_background: 'yes' }],
    ['permission type', { sandbox_permissions: 7, justification: 'Need access' }],
    ['permission value', { sandbox_permissions: 'read-only', justification: 'Need access' }],
    ['missing justification', { sandbox_permissions: 'workspace-write' }],
    ['orphan justification', { justification: 'Need access' }],
    ['blank justification', { sandbox_permissions: 'workspace-write', justification: ' ' }],
  ])('keeps malformed standard-shell optional fields generic: %s', (_label, fields) => {
    expect(terminalCardModel(running({ argsRaw: shellArgs(fields) }))).toBeNull()
  })

  it('accepts valid optional and unknown standard-shell fields on the open parameter root', () => {
    expect(terminalCardModel(running({ argsRaw: shellArgs({
      timeoutMs: 1_000,
      sandbox_permissions: 'workspace-write',
      justification: 'Write generated output',
      extension: { version: 1 },
    }) }))).not.toBeNull()
  })

  it('validates terminal_send optional fields while retaining open-root extensions', () => {
    const send = (over: Record<string, unknown>) => running({
      name: 'terminal_send',
      argsRaw: JSON.stringify({ sessionId: 'pty-1', text: 'make', ...over }),
    })
    expect(terminalCardModel(send({ submit: 'yes' }))).toBeNull()
    expect(terminalCardModel(send({ run_in_background: 'yes' }))).toBeNull()
    expect(terminalCardModel(send({ submit: false, run_in_background: false }))).not.toBeNull()
    expect(terminalCardModel(send({ extension: { version: 1 } }))).not.toBeNull()
  })

  it('keeps persistent shells with open-root extension fields on the running-card path', () => {
    const argsRaw = JSON.stringify({ command: 'pwd', extension: { version: 1 } })
    expect(terminalCardModel(running({ argsRaw }))).not.toBeNull()
    expect(terminalCardModel(running({ name: 'pwsh', argsRaw }))).not.toBeNull()
  })
})
