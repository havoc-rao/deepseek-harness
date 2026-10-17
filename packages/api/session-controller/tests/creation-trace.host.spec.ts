import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
/** Real Cordis observation service exports Peer-bound creation traces without payload metadata. */
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { HostConnectionService } from '../../../client/connection/src/rpc-host.ts'
import { bridge } from '../../../client/connection/src/http-bridge.ts'
import type { BrowserAuth } from '../../../client/connection/src/browser-auth.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import type { ConnectionRpcHandler, PeerScope } from '@deepseek-ai/dsh-client-connection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Observability from '@deepseek-ai/dsh-observability-otel'
import { ObservabilityRuntime } from '../../../telemetry/observability-otel/src/runtime.ts'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { creationTraceFixture } from '../../../telemetry/observability-otel/tests/creation-trace-fixture.ts'
import { decodeTraces, decodeMetrics, otlpWireCollector } from '../../../telemetry/observability-otel/tests/otlp-wire-fixture.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreationObservations } from '../src/creation-observation.ts'
import type { SessionController } from '../src/index.ts'
import type { SessionCreationObservationLegacyReport, SessionCreationObservationTimelineReport, SessionCreationObservationV2 } from '../src/types.ts'
import { createSessionTestController } from './test-remote.ts'

const extensionOwner = 'dsh-enhanced-workspace'
const controllerOwner = '@deepseek-ai/dsh-api-session-controller'
const gatewayOwner = '@deepseek-ai/dsh-api-gateway'
const connectionOwner = '@deepseek-ai/dsh-client-connection'
const contexts: Context[] = []
const runtimes: ObservabilityRuntime[] = []
const directories: string[] = []
afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  } finally {
    try {
      for (const runtime of runtimes.splice(0)) await runtime.shutdown()
    } finally {
      vi.restoreAllMocks()
      for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
    }
  }
})

async function fixture(owners = [extensionOwner, controllerOwner], endpoint?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-creation-trace-'))
  directories.push(cwd)
  const telemetry = await creationTraceFixture(owners, endpoint)
  const { runtime, spans, measurements } = telemetry
  runtimes.push(runtime)
  // Inject exporters only at activation; the service and every observation method remain real.
  const activation = vi.spyOn(ObservabilityRuntime, 'create').mockResolvedValueOnce(runtime)
  try { await ctx.plugin(Observability, { enabled: false }) } finally { activation.mockRestore() }
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  const id = randomUUID()
  const workspace: Workspace = {
    id: `private-workspace-${id}` as WorkspaceId, path: cwd, title: `private-title-${id}`,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', sessionIds: [],
    attachSession: vi.fn(() => Promise.resolve()), setTitle: () => Promise.resolve(),
    insertSessionBefore: () => Promise.resolve(), detachSession: () => Promise.resolve(),
    status: () => Promise.resolve('ok'),
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
  const observations = new CreationObservations(ctx, 2, 60000)
  return { ...telemetry, ctx, cwd, spans, measurements, runtime, controller, workspace, initialize, observations }
}

const phases: SessionCreationObservationLegacyReport['phases'] = [
  { phase: 'command.entryToReady', durationMs: 25 },
  { phase: 'command.navigation', durationMs: 3 },
  { phase: 'client.createRoundTrip', durationMs: 12 },
  { phase: 'client.catalogProjection', durationMs: 2 },
  { phase: 'client.retainBinding', durationMs: 1 },
  { phase: 'client.initialOpen', durationMs: 7 },
]

describe('creation traces through the real observation service', () => {
  it.each(['success', 'error'] as const)('exports actual Host response framing, writing, and finish for %s on OTLP wire', async (outcome) => {
    const collector = await otlpWireCollector()
    const finished = Promise.withResolvers<undefined>()
    let stopServer: (() => Promise<void>) | undefined
    try {
      const f = await fixture([extensionOwner, controllerOwner, gatewayOwner, connectionOwner], collector.endpoint)
      await f.ctx.plugin((ctx) => { new HostConnectionService(ctx, [], {} as BrowserAuth) })
      const connection = f.ctx.get('connection') as HostConnectionService
      await f.ctx.plugin(Gateway)
      const handler = connection.createSharedFetchHandler('/api')
      const server = createServer((request, response) => {
        response.once('finish', () => { finished.resolve(undefined) })
        void bridge(request, response, handler, connection.browserPeer)
      })
      stopServer = () => new Promise<void>((resolve, reject) => server.close((error) => {
        if (error) reject(error)
        else resolve()
      }))
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Expected loopback TCP address')
      const peer = connection.browserPeer
      const capability = await f.ctx.typertGateway.invoke({
        namespace: 'session', method: 'beginCreationObservationV2', args: {}, peer,
      }) as SessionCreationObservationV2
      const sessionId = SessionId(`private-response-session-${randomUUID()}`)
      const privateError = `private-response-error-${randomUUID()}`
      if (outcome === 'error') f.initialize.mockRejectedValueOnce(new RemoteError('agent-preset/invalid', privateError, {
        agentPreset: 'fixture', reason: 'initialization failed',
      }))
      const response = await fetch(`http://127.0.0.1:${address.port}/api/session/create`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'fixture-response', method: 'session/create',
          payload: { args: { request: { sessionId, workspaceId: f.workspace.id, observationToken: capability.token } } },
        }),
      })
      expect(response.status).toBe(200)
      const envelope: unknown = await response.json()
      expect(envelope).toMatchObject(outcome === 'success'
        ? { result: { ok: true, value: { sessionId } } }
        : { result: { ok: false, error: { code: 'agent-preset/invalid', message: privateError } } })
      await finished.promise
      await f.ctx.typertGateway.invoke({ namespace: 'session', method: 'finishCreationObservation', peer,
        args: { report: { token: capability.token, outcome, timeline: [] } },
      })
      await f.runtime.forceFlush()
      const spans = collector.requests.filter(request => request.path === '/v1/traces').flatMap(request => decodeTraces(request.bytes))
      const root = spans.find(span => span.name === 'command.sessionCreation')!
      for (const phase of ['host.responseFrame', 'host.responseWrite', 'host.responseFinish']) {
        const span = spans.find(value => value.name === phase)
        expect(span).toBeDefined()
        expect(span?.traceId).toBe(root.traceId)
        expect(span?.parentSpanId).toBe(root.spanId)
        expect(span?.scope).toBe(connectionOwner)
        expect(span?.attributes).toEqual({ 'dsh.owner': connectionOwner, 'dsh.operation': phase, 'dsh.outcome': 'success' })
      }
      for (const request of collector.requests) {
        for (const sentinel of [capability.token, sessionId, privateError, f.workspace.id, f.cwd, f.workspace.title]) {
          expect(request.bytes.includes(Buffer.from(sentinel))).toBe(false)
        }
      }
      await f.ctx.fiber.dispose()
      await f.runtime.shutdown()
    } finally {
      for (const runtime of runtimes.splice(0)) await runtime.shutdown()
      await stopServer?.()
      await collector.close()
    }
  })

  it('exports encoded Gateway create phases and negative begin intervals on actual OTLP wire', async () => {
    const collector = await otlpWireCollector()
    try {
      const f = await fixture([extensionOwner, controllerOwner, gatewayOwner, connectionOwner], collector.endpoint)
      const peer: PeerScope = new Peer(f.ctx, { principal: { kind: 'owner' } })
      let handle: ConnectionRpcHandler | undefined
      f.ctx.provide('connection', {
        operator: peer,
        rpc: { intercept: (_channel: string, _matches: (endpoint: string) => boolean, handler: ConnectionRpcHandler) => {
          handle = handler
          return () => { handle = undefined }
        } },
      } as never)
      await f.ctx.plugin(Gateway)
      if (handle === undefined) throw new Error('Gateway RPC interception is not installed')
      const rpc = handle
      const signal = new AbortController().signal
      const capability = await f.ctx.typertGateway.invoke({
        namespace: 'session', method: 'beginCreationObservationV2', args: {}, peer,
      }) as SessionCreationObservationV2
      const sessionId = SessionId(`private-codec-session-${randomUUID()}`)
      const created = await rpc('session/create', { args: { request: {
        sessionId, workspaceId: f.workspace.id, observationToken: capability.token,
      } } }, signal, peer)
      expect(created).toMatchObject({ ok: true, value: { sessionId } })
      const report: SessionCreationObservationTimelineReport = { token: capability.token, outcome: 'error', timeline: [
        { phase: 'client.observationBegin', startOffsetMs: -25, endOffsetMs: 0, outcome: 'success' },
        { phase: 'command.entryToReady', startOffsetMs: -40, endOffsetMs: 80, outcome: 'timeout' },
        { phase: 'client.rpcWait', startOffsetMs: 5, endOffsetMs: 35, outcome: 'success' },
        { phase: 'client.responseDecode', startOffsetMs: 100, endOffsetMs: 170, outcome: 'success' },
        { phase: 'client.responseBodyRead', startOffsetMs: 105, endOffsetMs: 120, outcome: 'success' },
        { phase: 'client.responseEnvelopeParse', startOffsetMs: 120, endOffsetMs: 125, outcome: 'success' },
        { phase: 'client.responseFormData', startOffsetMs: 125, endOffsetMs: 140, outcome: 'success' },
        { phase: 'client.responseBinaryRead', startOffsetMs: 140, endOffsetMs: 165, outcome: 'success' },
        { phase: 'client.resultCodecDecode', startOffsetMs: 170, endOffsetMs: 180, outcome: 'success' },
      ] }
      await f.ctx.typertGateway.invoke({ namespace: 'session', method: 'finishCreationObservation', args: { report }, peer })
      await f.runtime.forceFlush()
      const spans = collector.requests.filter(request => request.path === '/v1/traces').flatMap(request => decodeTraces(request.bytes))
      const root = spans.find(span => span.name === 'command.sessionCreation')!
      const dispatch = spans.find(span => span.name === 'gateway.dispatch')!
      expect(root.attributes['dsh.outcome']).toBe('error')
      for (const name of ['gateway.prepare', 'gateway.dispatch', 'gateway.resultEncode']) {
        const span = spans.find(item => item.name === name)!
        expect(span).toBeDefined()
        expect(span.traceId).toBe(root.traceId)
        expect(span.parentSpanId).toBe(root.spanId)
        expect(span.scope).toBe(gatewayOwner)
        expect(span.attributes).toEqual({ 'dsh.owner': gatewayOwner, 'dsh.operation': name, 'dsh.outcome': 'success' })
      }
      const controller = spans.find(span => span.name === 'session.create')!
      expect(controller.parentSpanId).toBe(root.spanId)
      expect(dispatch.traceId).toBe(controller.traceId)
      const begin = spans.find(span => span.name === 'client.observationBegin')!
      const entry = spans.find(span => span.name === 'command.entryToReady')!
      const wait = spans.find(span => span.name === 'client.rpcWait')!
      if (typeof begin.startTimeUnixNano !== 'bigint' || typeof begin.endTimeUnixNano !== 'bigint'
        || typeof entry.startTimeUnixNano !== 'bigint' || typeof entry.endTimeUnixNano !== 'bigint'
        || typeof wait.startTimeUnixNano !== 'bigint') throw new Error('Expected decoded OTLP endpoints')
      expect(begin.endTimeUnixNano - begin.startTimeUnixNano).toBe(25000000n)
      expect(wait.startTimeUnixNano - begin.endTimeUnixNano).toBe(5000000n)
      expect(entry.startTimeUnixNano - begin.endTimeUnixNano).toBe(-40000000n)
      expect(entry.endTimeUnixNano - entry.startTimeUnixNano).toBe(120000000n)
      expect(begin.attributes['dsh.outcome']).toBe('success')
      expect(entry.attributes['dsh.outcome']).toBe('timeout')
      const inclusive = spans.find(span => span.name === 'client.responseDecode')!
      expect(inclusive.traceId).toBe(root.traceId)
      expect(inclusive.parentSpanId).toBe(root.spanId)
      expect(inclusive.scope).toBe(connectionOwner)
      for (const phase of report.timeline.filter(item => ['client.responseBodyRead', 'client.responseEnvelopeParse',
        'client.responseFormData', 'client.responseBinaryRead'].includes(item.phase))) {
        const span = spans.find(item => item.name === phase.phase)!
        expect(span.traceId).toBe(root.traceId)
        expect(span.parentSpanId).toBe(inclusive.spanId)
        expect(span.scope).toBe(connectionOwner)
        expect(span.attributes).toEqual({ 'dsh.owner': connectionOwner, 'dsh.operation': phase.phase, 'dsh.outcome': 'success' })
        if (typeof span.startTimeUnixNano !== 'bigint' || typeof span.endTimeUnixNano !== 'bigint'
          || typeof begin.endTimeUnixNano !== 'bigint') throw new Error('Expected decoded response interval endpoints')
        expect(span.startTimeUnixNano - begin.endTimeUnixNano).toBe(BigInt(phase.startOffsetMs) * 1000000n)
        expect(span.endTimeUnixNano - begin.endTimeUnixNano).toBe(BigInt(phase.endOffsetMs) * 1000000n)
      }
      const resultCodec = spans.find(span => span.name === 'client.resultCodecDecode')!
      expect(resultCodec.traceId).toBe(root.traceId)
      expect(resultCodec.parentSpanId).toBe(root.spanId)
      expect(resultCodec.scope).toBe(gatewayOwner)
      expect(resultCodec.attributes).toEqual({
        'dsh.owner': gatewayOwner, 'dsh.operation': 'client.resultCodecDecode', 'dsh.outcome': 'success',
      })
      for (const request of collector.requests) {
        for (const privateValue of [capability.token, sessionId, f.cwd, f.workspace.id, f.workspace.title]) {
          expect(request.bytes.includes(Buffer.from(privateValue))).toBe(false)
        }
      }
      await f.ctx.fiber.dispose()
    } finally {
      for (const runtime of runtimes.splice(0)) await runtime.shutdown()
      await collector.close()
    }
  })
  it('exports V2 Gateway timeline endpoints on actual OTLP wire with independent outcomes', async () => {
    const collector = await otlpWireCollector()
    try {
      const f = await fixture(undefined, collector.endpoint)
      await f.ctx.plugin(Gateway)
      const peer: PeerScope = new Peer(f.ctx, { principal: { kind: 'owner' } })
      const before = Date.now()
      const capability = await f.ctx.typertGateway.invoke({
        namespace: 'session', method: 'beginCreationObservationV2', args: {}, peer,
      }) as SessionCreationObservationV2
      const after = Date.now()
      expect(capability.version).toBe(2)
      const report: SessionCreationObservationTimelineReport = { token: capability.token, outcome: 'error', timeline: [
        { phase: 'client.rpcWait', startOffsetMs: 10, endOffsetMs: 30, outcome: 'success' },
        { phase: 'client.historyOpen', startOffsetMs: 35, endOffsetMs: 75, outcome: 'timeout' },
      ] }
      await f.ctx.typertGateway.invoke({ namespace: 'session', method: 'finishCreationObservation', args: { report }, peer })
      await f.runtime.forceFlush()
      const spans = collector.requests.filter(request => request.path === '/v1/traces').flatMap(request => decodeTraces(request.bytes))
      const root = spans.find(span => span.name === 'command.sessionCreation')!
      const wait = spans.find(span => span.name === 'client.rpcWait')!
      const open = spans.find(span => span.name === 'client.historyOpen')!
      expect(root.attributes['dsh.outcome']).toBe('error')
      expect(wait.attributes['dsh.outcome']).toBe('success')
      expect(open.attributes['dsh.outcome']).toBe('timeout')
      expect(wait.parentSpanId).toBe(root.spanId)
      expect(open.parentSpanId).toBe(root.spanId)
      const waitStart = wait.startTimeUnixNano
      const waitEnd = wait.endTimeUnixNano
      const openStart = open.startTimeUnixNano
      const openEnd = open.endTimeUnixNano
      if (typeof waitStart !== 'bigint' || typeof waitEnd !== 'bigint' || typeof openStart !== 'bigint' || typeof openEnd !== 'bigint') {
        throw new Error('Expected decoded OTLP fixed64 endpoints')
      }
      expect(waitEnd - waitStart).toBe(20000000n)
      expect(openStart - waitStart).toBe(25000000n)
      expect(openEnd - openStart).toBe(40000000n)
      expect(waitStart >= BigInt(before + 10) * 1000000n).toBe(true)
      expect(waitStart <= BigInt(after + 10) * 1000000n).toBe(true)
      for (const request of collector.requests) expect(request.bytes.includes(Buffer.from(capability.token))).toBe(false)
      await f.ctx.fiber.dispose()
    } finally {
      for (const runtime of runtimes.splice(0)) await runtime.shutdown()
      await collector.close()
    }
  })
  it.each(['success', 'error'] as const)('links public Gateway begin/create/finish calls for one Peer on %s', async (outcome) => {
    const f = await fixture()
    await f.ctx.plugin(Gateway)
    const peer: PeerScope = new Peer(f.ctx, { principal: { kind: 'owner' } })
    const foreignPeer: PeerScope = new Peer(f.ctx, { principal: { kind: 'owner' } })
    expect(f.ctx.observability.selected(extensionOwner)).toBe(true)
    expect(f.ctx.observability.selected(controllerOwner)).toBe(true)
    expect(f.controller.beginCreationObservation()).toBeNull()
    const legacyBegin = vi.spyOn(f.controller, 'beginCreationObservation')
      .mockImplementation(function (this: SessionController) {
        expect(this.ctx.invocation?.peer).toBe(peer)
        const invocation = this.ctx.get('invocation')
        return invocation === undefined ? null : f.observations.begin(invocation.peer)
      })
    await expect(f.ctx.typertGateway.invoke({
      namespace: 'session', method: 'beginCreationObservation', args: {}, peer,
    })).resolves.toBeNull()
    legacyBegin.mockRestore()
    const token = await f.ctx.typertGateway.invoke({
      namespace: 'session', method: 'beginCreationObservation', args: {}, peer,
    })
    expect(token).not.toBeNull()
    expect(typeof token).toBe('string')
    const attach = vi.spyOn(f.workspace, 'attachSession')
    const sessionId = SessionId(`private-gateway-session-${randomUUID()}`)
    const error = new RemoteError('agent-preset/invalid', 'private-gateway-error', {
      agentPreset: 'fixture', reason: 'initialization failed',
    })
    if (outcome === 'error') f.initialize.mockRejectedValueOnce(error)
    const create = f.ctx.typertGateway.invoke({
      namespace: 'session', method: 'create', peer,
      args: { request: { sessionId, workspaceId: f.workspace.id, observationToken: token } },
    })
    if (outcome === 'success') await expect(create).resolves.toEqual({ sessionId })
    else await expect(create).rejects.toBe(error)
    expect(f.initialize).toHaveBeenCalledTimes(1)
    const report = { token, outcome, phases }
    await f.ctx.typertGateway.invoke({
      namespace: 'session', method: 'finishCreationObservation', args: { report }, peer: foreignPeer,
    })
    expect(f.spans.getFinishedSpans().some(span => span.name === 'command.sessionCreation')).toBe(false)
    await f.ctx.typertGateway.invoke({
      namespace: 'session', method: 'finishCreationObservation', args: { report }, peer,
    })
    await f.runtime.forceFlush()
    const finished = f.spans.getFinishedSpans()
    const root = finished.find(span => span.name === 'command.sessionCreation')!
    const host = finished.find(span => span.name === 'session.create')!
    expect(root).toBeDefined()
    expect(host.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    expect(finished.filter(span => span.name === 'command.sessionCreation')).toHaveLength(1)
    for (const span of finished) {
      expect(span.spanContext().traceId).toBe(root.spanContext().traceId)
      expect(span.attributes['dsh.outcome']).toBe(outcome)
      if (phases.some(item => item.phase === span.name)) {
        expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
      }
    }
    expect(finished.filter(span => phases.some(item => item.phase === span.name))).toHaveLength(phases.length)
    expect(attach).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0)
    expect(f.isRootContext()).toBe(true)
  })

  it.each(['success', 'error'] as const)('exports decoded HTTP/protobuf creation traces and metrics for %s', async (outcome) => {
    const collector = await otlpWireCollector()
    try {
      const f = await fixture(undefined, collector.endpoint)
      const peer = {}
      const token = f.observations.begin(peer)!
      const sessionId = SessionId(`private-wire-session-${randomUUID()}`)
      const content = `private-wire-content-${randomUUID()}`
      const error = new RemoteError('agent-preset/invalid', `private-wire-error-${randomUUID()}`, {
        agentPreset: 'fixture', reason: 'initialization failed',
      })
      if (outcome === 'error') f.initialize.mockRejectedValueOnce(error)
      const create = f.observations.create(token, peer, async () => {
        const created = await f.controller.create({ sessionId, workspaceId: f.workspace.id })
        return { ...created, privateContent: content }
      })
      if (outcome === 'success') await expect(create).resolves.toEqual({ sessionId, privateContent: content })
      else await expect(create).rejects.toBe(error)
      f.observations.finish({ token, outcome, phases }, peer)
      await f.runtime.forceFlush()
      const traceRequests = collector.requests.filter(request => request.path === '/v1/traces')
      const metricRequests = collector.requests.filter(request => request.path === '/v1/metrics')
      expect(traceRequests).toHaveLength(1)
      expect(metricRequests).toHaveLength(1)
      const spans = traceRequests.flatMap(request => decodeTraces(request.bytes))
      const root = spans.find(span => span.name === 'command.sessionCreation')!
      const host = spans.find(span => span.name === 'session.create')!
      const ensure = spans.find(span => span.name === 'session.create.ensureSession')!
      expect(spans.map(span => span.name).sort()).toEqual([
        'command.sessionCreation', 'session.create', 'session.create.ensureSession',
        'session.create.agentInitialization', ...(outcome === 'success' ? ['session.create.attachSession'] : []),
        ...phases.map(item => item.phase),
      ].sort())
      expect(root.parentSpanId).toBe('')
      expect(root.kind).toBe(3)
      expect(host.parentSpanId).toBe(root.spanId)
      expect(ensure.parentSpanId).toBe(host.spanId)
      expect(spans.find(span => span.name === 'session.create.agentInitialization')!.parentSpanId).toBe(ensure.spanId)
      for (const span of spans) {
        const owner = span.name.startsWith('command.') ? extensionOwner : controllerOwner
        expect(span.traceId).toBe(root.traceId)
        expect(span.traceId).toMatch(/^[a-f0-9]{32}$/)
        expect(span.spanId).toMatch(/^[a-f0-9]{16}$/)
        expect(span.attributes).toEqual({ 'dsh.owner': owner, 'dsh.operation': span.name, 'dsh.outcome': outcome })
        expect(span.scope).toBe(owner)
        expect(span.resource).toEqual({ 'service.name': 'DSH' })
        expect(span.events).toBe(0)
        expect(span.links).toBe(0)
        expect(span.statusMessage).toBe('')
        expect(span.status).toBe(outcome === 'error' ? 2 : 0)
        if (phases.some(phase => phase.phase === span.name)) expect(span.parentSpanId).toBe(root.spanId)
        if (span.name === 'session.create.attachSession') expect(span.parentSpanId).toBe(host.spanId)
      }
      const metrics = metricRequests.flatMap(request => decodeMetrics(request.bytes))
      expect(new Set(metrics.map(metric => metric.name))).toEqual(new Set(['dsh.operation.count', 'dsh.operation.duration']))
      for (const metric of metrics) {
        expect([extensionOwner, controllerOwner]).toContain(metric.scope)
        expect(metric.resource).toEqual({ 'service.name': 'DSH' })
        expect(metric.attributes.length).toBeGreaterThan(0)
        for (const attributes of metric.attributes) {
          expect(Object.keys(attributes).sort()).toEqual(['dsh.operation', 'dsh.outcome', 'dsh.owner'])
          expect(attributes['dsh.owner']).toBe(metric.scope)
          expect(attributes['dsh.outcome']).toBe(outcome)
          expect(spans.some(span => span.name === attributes['dsh.operation'] && span.scope === metric.scope)).toBe(true)
        }
      }
      for (const request of collector.requests) {
        expect(request.contentType).toBe('application/x-protobuf')
        for (const privateValue of [token, sessionId, content, error.message, f.cwd, f.workspace.id, f.workspace.title]) {
          expect(request.bytes.includes(Buffer.from(privateValue))).toBe(false)
        }
      }
      await f.ctx.fiber.dispose()
      await f.runtime.shutdown()
    } finally {
      for (const runtime of runtimes.splice(0)) await runtime.shutdown()
      await collector.close()
    }
  })
  it.each(['success', 'error'] as const)('links host creation and reported phases beneath one private %s root', async (outcome) => {
    const f = await fixture()
    const peer = {}
    const token = f.observations.begin(peer)!
    expect(token).not.toBeNull()
    const sessionId = SessionId(`private-session-${randomUUID()}`)
    const error = new RemoteError('agent-preset/invalid', `private-error-${randomUUID()}`, {
      agentPreset: 'fixture', reason: 'initialization failed',
    })
    if (outcome === 'error') f.initialize.mockRejectedValueOnce(error)
    const create = f.observations.create(token, peer, () => f.controller.create({
      sessionId, workspaceId: f.workspace.id,
    }))
    if (outcome === 'success') await expect(create).resolves.toEqual({ sessionId })
    else await expect(create).rejects.toBe(error)
    f.observations.finish({ token, outcome, phases }, peer)
    await f.runtime.forceFlush()

    const finished = f.spans.getFinishedSpans()
    const root = finished.find(span => span.name === 'command.sessionCreation')!
    const host = finished.find(span => span.name === 'session.create')!
    const ensure = finished.find(span => span.name === 'session.create.ensureSession')!
    const initialize = finished.find(span => span.name === 'session.create.agentInitialization')!
    expect(finished.map(span => span.name).sort()).toEqual([
      'command.sessionCreation', 'session.create', 'session.create.ensureSession',
      'session.create.agentInitialization', ...(outcome === 'success' ? ['session.create.attachSession'] : []),
      ...phases.map(item => item.phase),
    ].sort())
    expect(root.parentSpanContext).toBeUndefined()
    expect(root.kind).toBe(f.clientKind)
    expect(host.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    expect(ensure.parentSpanContext?.spanId).toBe(host.spanContext().spanId)
    expect(initialize.parentSpanContext?.spanId).toBe(ensure.spanContext().spanId)
    if (outcome === 'success') {
      expect(finished.find(span => span.name === 'session.create.attachSession')!.parentSpanContext?.spanId)
        .toBe(host.spanContext().spanId)
    }
    for (const item of phases) {
      const span = finished.find(span => span.name === item.phase)!
      expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
      expect(span.duration[0] * 1000 + span.duration[1] / 1e6).toBeCloseTo(item.durationMs, 3)
    }
    for (const span of finished) {
      expect(span.spanContext().traceId).toBe(root.spanContext().traceId)
      const owner = span.name.startsWith('command.') ? extensionOwner : controllerOwner
      expect(span.attributes).toEqual({ 'dsh.owner': owner, 'dsh.operation': span.name, 'dsh.outcome': outcome })
      expect(span.instrumentationScope.name).toBe(owner)
      expect(span.resource.attributes).toEqual({ 'service.name': 'DSH' })
      expect(span.events).toEqual([])
      expect(span.links).toEqual([])
      expect(span.status).toEqual({ code: outcome === 'error' ? f.errorStatus : f.unsetStatus })
    }
    const exported = JSON.stringify({
      spans: finished.map(span => ({ name: span.name, attributes: span.attributes, resource: span.resource.attributes,
        scope: span.instrumentationScope, events: span.events, links: span.links, status: span.status })),
      metrics: f.measurements.getMetrics(),
    })
    for (const privateValue of [token, f.cwd, sessionId, f.workspace.id, f.workspace.title, error.message]) {
      expect(exported).not.toContain(privateValue)
    }
    expect(f.isRootContext()).toBe(true)
    await f.ctx.fiber.dispose()
    expect(f.ctx.get('observability')).toBeUndefined()
    expect(f.runtime.selected(extensionOwner)).toBe(false)
    expect(f.observations.begin(peer)).toBeNull()
    expect(f.isRootContext()).toBe(true)
  })

  it('collects only exact selected owners without promoting controller phases to the command owner', async () => {
    const f = await fixture([extensionOwner])
    const peer = {}
    const token = f.observations.begin(peer)!
    expect(f.ctx.observability.selected(`${extensionOwner}-child`)).toBe(false)
    await f.observations.create(token, peer, () => f.ctx.observability.run(controllerOwner, 'session.create', async () => {
      await Promise.resolve()
      return 'unchanged'
    }))
    f.observations.finish({ token, outcome: 'success', phases }, peer)
    await f.runtime.forceFlush()
    const finished = f.spans.getFinishedSpans()
    expect(finished.map(span => span.name).sort()).toEqual([
      'command.sessionCreation', 'command.entryToReady', 'command.navigation',
    ].sort())
    expect(finished.every(span => span.attributes['dsh.owner'] === extensionOwner)).toBe(true)
    expect(JSON.stringify(f.measurements.getMetrics())).not.toContain(controllerOwner)
  })

  it('does not allocate a command capability when only the controller is selected', async () => {
    const f = await fixture([controllerOwner])
    const peer = {}
    expect(f.observations.begin(peer)).toBeNull()
    const result = await f.observations.create(undefined, peer, () => f.controller.create({ workspaceId: f.workspace.id }))
    expect(result.sessionId).toMatch(/^session-/)
    await f.runtime.forceFlush()
    const finished = f.spans.getFinishedSpans()
    expect(finished).toHaveLength(4)
    expect(finished.find(span => span.name === 'session.create')!.parentSpanContext).toBeUndefined()
    expect(finished.every(span => span.attributes['dsh.owner'] === controllerOwner)).toBe(true)
    expect(finished.every(span => span.resource.attributes['service.name'] === 'DSH')).toBe(true)
  })
})
