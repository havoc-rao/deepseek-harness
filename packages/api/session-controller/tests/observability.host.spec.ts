import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import Observability, { type Outcome } from '@deepseek-ai/dsh-observability-otel'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

const owner = '@deepseek-ai/dsh-api-session-controller'
interface Observation {
  owner: string
  name: string
  parent?: string
  outcome?: Outcome
}

class RecordingObservability extends Observability {
  readonly records: Observation[] = []
  private readonly scope = new AsyncLocalStorage<string>()

  override run<T>(owner: string, name: string, fn: () => T): T {
    const parent = this.scope.getStore()
    const record: Observation = { owner, name, ...(parent === undefined ? {} : { parent }) }
    this.records.push(record)
    return this.scope.run(name, () => {
      try {
        const value = fn()
        if (value instanceof Promise) void value.then(
          () => { record.outcome = 'success' },
          () => { record.outcome = 'error' },
        )
        else record.outcome = 'success'
        return value
      } catch (error) {
        record.outcome = 'error'
        throw error
      }
    })
  }
}

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(mode: 'missing' | 'disabled' | 'recording') {
  const ctx = new Context()
  contexts.push(ctx)
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-session-observation-'))
  directories.push(cwd)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (mode === 'disabled') await ctx.plugin(Observability, { enabled: false })
  if (mode === 'recording') await ctx.plugin(RecordingObservability, { enabled: false })
  const attachSession = vi.fn(() => Promise.resolve())
  const workspace: Workspace = {
    id: 'fixture' as WorkspaceId, path: cwd, title: 'Fixture',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', sessionIds: [],
    attachSession, setTitle: () => Promise.resolve(), insertSessionBefore: () => Promise.resolve(),
    detachSession: () => Promise.resolve(), status: () => Promise.resolve('ok'),
  }
  ctx.provide('workspaceRegistry', { get: () => workspace, list: () => [workspace] } as never)
  const controller = createSessionTestController(ctx, {
    cwd, defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }),
  })
  const initialize = vi.spyOn(ctx.agents, 'create').mockImplementation(async (options) => {
    const session = ctx.sessions.create(options.sessionId, options.meta === undefined ? {} : { meta: options.meta })
    const agent = { id: session.id, session, ctx, status: 'idle' } as Agent
    await ctx.agents.register(agent)
    return { agent, dispose: () => Promise.resolve() }
  })
  return { ctx, cwd, controller, workspace, attachSession, initialize }
}

function records(ctx: Context): Observation[] {
  return (ctx.get('observability') as RecordingObservability).records
}

describe('Host Session creation observations', () => {
  it.each(['missing', 'disabled'] as const)('preserves success, adoption and error identity with %s collection', async (mode) => {
    const { controller, workspace, initialize, attachSession } = await setup(mode)
    const sessionId = SessionId('observed-session')
    const request = { sessionId, workspaceId: workspace.id }
    await expect(controller.create(request)).resolves.toEqual({ sessionId })
    await expect(controller.create(request)).resolves.toEqual({ sessionId })
    expect(initialize).toHaveBeenCalledOnce()
    expect(attachSession).toHaveBeenCalledTimes(2)
    const failure = new RemoteError('agent-preset/invalid', 'fixture initialization failed', { agentPreset: 'fixture', reason: 'initialization failed' })
    initialize.mockRejectedValueOnce(failure)
    await expect(controller.create({ sessionId: SessionId('failed-session'), workspaceId: workspace.id }))
      .rejects.toBe(failure)
    expect(attachSession).toHaveBeenCalledTimes(2)
  })

  it('nests initialization inside ensureSession and attachment directly inside create', async () => {
    const { ctx, controller, workspace } = await setup('recording')
    const created = await controller.create({ workspaceId: workspace.id })
    expect(created.sessionId).toMatch(/^session-/)
    expect(records(ctx)).toEqual([
      { owner, name: 'session.create', outcome: 'success' },
      { owner, name: 'session.create.ensureSession', parent: 'session.create', outcome: 'success' },
      { owner, name: 'session.create.agentInitialization', parent: 'session.create.ensureSession', outcome: 'success' },
      { owner, name: 'session.create.attachSession', parent: 'session.create', outcome: 'success' },
    ])
  })

  it('observes persisted adoption initialization but not live adoption initialization', async () => {
    const { ctx, cwd, controller, workspace, initialize } = await setup('recording')
    const session = ctx.sessions.create(SessionId('persisted-session'), { meta: { cwd } })
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([session.header]),
      inspect: () => Promise.resolve({ meta: session.header, events: [] }),
    }) as never)
    const agent = { id: session.id, session, ctx, status: 'idle' } as Agent
    const resume = vi.spyOn(ctx.agents, 'resume').mockImplementation(async () => {
      await ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    })
    const request = { sessionId: session.id, workspaceId: workspace.id }
    await expect(controller.create(request)).resolves.toEqual({ sessionId: session.id })
    await expect(controller.create(request)).resolves.toEqual({ sessionId: session.id })
    expect(initialize).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledOnce()
    expect(records(ctx).filter(record => record.name === 'session.create.agentInitialization')).toHaveLength(1)
  })

  it('preserves initialization errors and observes error settlement without attachment', async () => {
    const { ctx, controller, workspace, initialize, attachSession } = await setup('recording')
    const failure = new RemoteError('agent-preset/invalid', 'private fixture failure', { agentPreset: 'fixture', reason: 'initialization failed' })
    initialize.mockRejectedValueOnce(failure)
    await expect(controller.create({ workspaceId: workspace.id })).rejects.toBe(failure)
    expect(attachSession).not.toHaveBeenCalled()
    expect(records(ctx).map(record => [record.name, record.outcome])).toEqual([
      ['session.create', 'error'], ['session.create.ensureSession', 'error'],
      ['session.create.agentInitialization', 'error'],
    ])
  })

  it('retains workspace attachment failure mapping and the created Agent', async () => {
    const { ctx, controller, workspace, attachSession } = await setup('recording')
    attachSession.mockRejectedValueOnce(new Error('private attachment failure'))
    const sessionId = SessionId('attachment-failure')
    await expect(controller.create({ sessionId, workspaceId: workspace.id })).rejects.toMatchObject({
      code: 'session/workspace-attach-failed', details: { sessionId, workspaceId: workspace.id },
    })
    expect(ctx.agents.get(sessionId)).toBeDefined()
    expect(records(ctx).map(record => [record.name, record.outcome])).toEqual([
      ['session.create', 'error'], ['session.create.ensureSession', 'success'],
      ['session.create.agentInitialization', 'success'], ['session.create.attachSession', 'error'],
    ])
  })
})
