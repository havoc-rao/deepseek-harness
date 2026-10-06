import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Observability, { type Outcome } from '@deepseek-ai/dsh-observability-otel'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { TimeoutReason } from '@deepseek-ai/dsh-timeout'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ToolRuntime, { defineTool, type ToolDefinition, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'

const owner = '@deepseek-ai/dsh-tool-test'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

async function setup(observe = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (observe) await ctx.plugin(Observability, { enabled: false })
  return ctx
}

function tool(name = 'registered', telemetryOwner = owner): ToolDefinition {
  return defineTool({
    name, description: 'fixture', parameters: {}, telemetryOwner,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'unchanged result' },
  })
}

function run(ctx: Context, options: Partial<ToolExecutionInput> = {}) {
  return ctx.tools.execute({
    callId: ToolCallId('private-call-id'), name: 'registered', arguments: { private: 'secret' },
    signal: new AbortController().signal, ...options,
  })
}

function recorder(ctx: Context, disabledOwner?: string) {
  const active = new AsyncLocalStorage<string>()
  const ended: Array<{ owner: string; operation: string; outcome: Outcome | undefined }> = []
  const start = vi.spyOn(ctx.observability, 'start').mockImplementation((owner, operation) => ({
    spanContext: undefined,
    with: fn => owner === disabledOwner ? fn() : active.run(owner, fn),
    end: (outcome) => { if (owner !== disabledOwner) ended.push({ owner, operation, outcome }) },
  }))
  return { active, ended, start }
}

describe('optional tool body observation', () => {
  it('observes execute and output projection only, with registered metadata and no payloads', async () => {
    const ctx = await setup()
    const record = recorder(ctx)
    const definition = tool('Registered-name.v2')
    ctx.tools.register({
      ...definition,
      async execute(args, exec) {
        expect(record.active.getStore()).toBe(owner)
        await Promise.resolve()
        expect(record.active.getStore()).toBe(owner)
        return definition.execute(args, exec)
      },
      output: { ...definition.output, render(args, value) {
        expect(record.active.getStore()).toBe(owner)
        return definition.output.render(args, value)
      } },
      finalizeContent() { expect(record.active.getStore()).toBeUndefined(); return undefined },
    })
    ctx.on('tools/pre-execute', async (_exec, next) => {
      expect(record.start).not.toHaveBeenCalled()
      return next()
    })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      expect(record.active.getStore()).toBeUndefined()
      expect(record.ended).toHaveLength(1)
      return next()
    })
    const result = await run(ctx, { name: definition.name })
    expect(result).toEqual({ isError: false, value: 'unchanged result', content: [{ type: 'text', text: 'unchanged result' }] })
    expect(record.start).toHaveBeenCalledExactlyOnceWith(owner, definition.name, { kind: 'internal' })
    expect(record.ended).toEqual([{ owner, operation: definition.name, outcome: 'success' }])
    expect(ctx.tools.schemas()).toEqual([{ name: definition.name, description: definition.description, parameters: definition.parameters }])
    expect((await ctx.systemPrompt.assemble()).tools).toEqual(ctx.tools.schemas())
  })

  it.each(['execute', 'render'] as const)('ends once when %s throws without exporting the exception', async (stage) => {
    const ctx = await setup()
    const record = recorder(ctx)
    const definition = tool()
    ctx.tools.register({
      ...definition,
      async execute() { if (stage === 'execute') throw new Error('private exception'); return 'ok' },
      output: { ...definition.output, render() { throw new Error('private projection') } },
    })
    expect((await run(ctx)).isError).toBe(true)
    expect(record.ended).toEqual([{ owner, operation: 'registered', outcome: 'error' }])
    expect(record.start).toHaveBeenCalledExactlyOnceWith(owner, 'registered', { kind: 'internal' })
  })

  it.each([false, true])('ends after cooperative cancellation settles (throw=%s)', async (throws) => {
    const ctx = await setup()
    const record = recorder(ctx)
    const controller = new AbortController()
    ctx.tools.register({ ...tool(), async execute() {
      controller.abort()
      await Promise.resolve()
      expect(record.ended).toEqual([])
      if (throws) throw new Error('private abort')
      return 'settled'
    } })
    expect((await run(ctx, { signal: controller.signal })).isError).toBe(true)
    expect(record.ended).toEqual([{ owner, operation: 'registered', outcome: 'cancelled' }])
  })

  it('classifies a timeout signal without recording its reason', async () => {
    const ctx = await setup()
    const record = recorder(ctx)
    const controller = new AbortController()
    ctx.tools.register({ ...tool(), async execute() { controller.abort(new TimeoutReason('TOOL_TIMEOUT', 10)); return 'done' } })
    await run(ctx, { signal: controller.signal })
    expect(record.ended).toEqual([{ owner, operation: 'registered', outcome: 'timeout' }])
  })

  it('skips missing owners, unknown tools, denied calls, and pre-dispatch cancellation', async () => {
    const ctx = await setup()
    const record = recorder(ctx)
    const { telemetryOwner, ...unowned } = tool()
    expect(telemetryOwner).toBe(owner)
    ctx.tools.register(unowned)
    expect((await run(ctx)).isError).toBe(false)
    await run(ctx, { name: 'unknown' })
    await run(ctx, { signal: AbortSignal.abort() })
    ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'denied' }))
    await run(ctx)
    expect(record.start).not.toHaveBeenCalled()
  })

  it.each([false, true])('preserves output with absent or disabled service (mounted=%s)', async (mounted) => {
    const ctx = await setup(mounted)
    ctx.tools.register(tool())
    expect((await run(ctx)).content).toEqual([{ type: 'text', text: 'unchanged result' }])
  })

  it('uses the definition actually resolved after pre-execute replaces it', async () => {
    const ctx = await setup()
    const record = recorder(ctx)
    const dispose = ctx.tools.register(tool())
    const replacementOwner = '@deepseek-ai/dsh-tool-replacement'
    ctx.on('tools/pre-execute', async (_exec, next) => {
      dispose()
      ctx.tools.register(tool('registered', replacementOwner))
      return next()
    })
    await run(ctx)
    expect(record.ended).toEqual([{ owner: replacementOwner, operation: 'registered', outcome: 'success' }])
  })

  it('resolves scoped owners and accepts one definition in multiple scopes', async () => {
    const ctx = await setup()
    const record = recorder(ctx)
    const first = {} as Agent
    const second = {} as Agent
    let a!: Scope
    let b!: Scope
    await ctx.plugin(Object.assign((inner: Context) => {
      a = createScope(inner, first)
      b = createScope(inner, second)
    }, { inject: ['tools'] }))
    const scopedOwner = '@deepseek-ai/dsh-tool-scoped'
    const scopedDefinition = tool('registered', scopedOwner)
    ctx.tools.register(tool())
    a.ctx.tools.register(scopedDefinition)
    b.ctx.tools.register(scopedDefinition)
    await run(ctx, { agent: first })
    await run(ctx, { agent: second })
    await run(ctx)
    expect(record.ended.map(entry => entry.owner)).toEqual([scopedOwner, scopedOwner, owner])
  })

  it('allows an enabled nested tool beneath a disabled owner', async () => {
    const ctx = await setup()
    const disabledOwner = '@deepseek-ai/dsh-tool-disabled'
    const record = recorder(ctx, disabledOwner)
    ctx.tools.register(tool('child'))
    ctx.tools.register({ ...tool('registered', disabledOwner), async execute(_args, exec) {
      const result = await run(ctx, { name: 'child', parent: exec.token })
      expect(result.isError).toBe(false)
      return 'parent'
    } })
    expect((await run(ctx)).isError).toBe(false)
    expect(record.ended).toEqual([{ owner, operation: 'child', outcome: 'success' }])
  })
})
