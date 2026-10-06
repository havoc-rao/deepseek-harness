/** Real Loader YAML composition, Gateway dispatch, and loopback OTLP export. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import Observability from '../src/index.ts'

const GATEWAY = '@deepseek-ai/dsh-api-gateway'
const RUNTIME = '@deepseek-ai/dsh-observability-otel'
const FIXTURE = '@fixture/remote'
const REGISTRY = '@deepseek-ai/dsh-typert-registry'
const SECRET = 'business-payload-must-not-be-exported'

class FixtureRemote extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'observationComposition') }

  @Remote
  echo(value: string): string { return value }

  @Remote({ mode: 'stream' })
  *follow(): Iterable<string> { yield SECRET }
}

interface Capture {
  path: string | undefined
  type: string | undefined
  body: Buffer
}

async function composition(config: Record<string, unknown>, valid = true): Promise<{ ctx: Context; bodies: Capture[] }> {
  const bodies: Capture[] = []
  const root = await mkdtemp(join(tmpdir(), 'dsh-observation-composition-'))
  const ctx = new Context()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      bodies.push({ path: request.url, type: request.headers['content-type'], body: Buffer.concat(chunks) })
      response.writeHead(200, { 'content-type': 'application/x-protobuf' })
      response.end()
    })
  })
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
    await rm(root, { recursive: true, force: true })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected loopback TCP server')
  const rows = [
    { name: RUNTIME, config: { endpoint: `http://127.0.0.1:${address.port}`, ...config } },
    { name: REGISTRY },
    { name: GATEWAY },
    { name: FIXTURE },
  ]
  const path = join(root, 'cordis.yml')
  await writeFile(path, rows.map(row => `- ${JSON.stringify(row)}`).join('\n') + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    [RUNTIME, Observability], [REGISTRY, TypertRegistry], [GATEWAY, Gateway], [FIXTURE, FixtureRemote],
  ])
  ctx.loader.internal = {
    version: 'v2',
    loadCache: new Map(),
    async import(specifier) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    },
    register() { throw new Error('test composition does not register module hooks') },
    getOrCreateModuleJob() { throw new Error('test composition does not create module jobs') },
    resolveSync() { throw new Error('test composition resolves explicit module names') },
    load() { throw new Error('test composition imports explicit module objects') },
  }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  if (valid) expect(ctx.get('observability')).toBeDefined()
  expect(ctx.get('typertGateway')).toBeDefined()
  return { ctx, bodies }
}

async function exercise(ctx: Context): Promise<void> {
  expect(await ctx.typertGateway.invoke({ namespace: 'observationComposition', method: 'echo', args: { value: SECRET } })).toBe(SECRET)
  const stream = await ctx.typertGateway.stream({ namespace: 'observationComposition', method: 'follow', args: {} })
  const received: unknown[] = []
  for await (const item of stream) received.push(item)
  expect(received).toEqual([SECRET])
  ctx.observability.run('@fixture/excluded', 'fixture.excluded', () => SECRET)
}

it.each([
  { traces: { enabled: 'false' }, metrics: { enabled: false } },
  { traces: { enabeld: false }, metrics: { enabled: false } },
  { traces: { enabled: null }, metrics: { enabled: false } },
])('rejects malformed YAML configuration without publishing service or exporting: %j', async (invalid) => {
  const { ctx, bodies } = await composition({ enabled: true, ...invalid }, false)
  const entry = [...ctx.loader.entries()].find(value => value.options.name === RUNTIME)
  expect(entry?.fiber?.state).toBe(FiberState.FAILED)
  await expect(entry?.fiber?.await()).rejects.toThrow('invalid config')
  expect(ctx.get('observability')).toBeUndefined()
  expect(await ctx.typertGateway.invoke({ namespace: 'observationComposition', method: 'echo', args: { value: SECRET } })).toBe(SECRET)
  await ctx.fiber.dispose()
  expect(bodies).toEqual([])
})

it('loads disabled collection by default without exporting business calls', async () => {
  const { ctx, bodies } = await composition({})
  await exercise(ctx)
  await ctx.fiber.dispose()
  expect(bodies).toEqual([])
})

it.each([
  { traces: true, metrics: true },
  { traces: false, metrics: true },
])('exports selected Gateway component with traces=$traces metrics=$metrics', async (signals) => {
  const { ctx, bodies } = await composition({
    enabled: true,
    collection: { default: { traces: false, metrics: false }, plugins: { [GATEWAY]: signals } },
  })
  await exercise(ctx)
  await ctx.fiber.dispose()
  expect(new Set(bodies.map(body => body.path))).toEqual(new Set(signals.traces ? ['/v1/traces', '/v1/metrics'] : ['/v1/metrics']))
  for (const { body, type } of bodies) {
    expect(type).toBe('application/x-protobuf')
    expect(body.includes(Buffer.from(GATEWAY))).toBe(true)
    expect(body.includes(Buffer.from('gateway.invoke observationComposition/echo'))).toBe(true)
    expect(body.includes(Buffer.from('gateway.stream observationComposition/follow'))).toBe(true)
    expect(body.includes(Buffer.from(SECRET))).toBe(false)
    expect(body.includes(Buffer.from('@fixture/excluded'))).toBe(false)
  }
  expect(ctx.get('observability')).toBeUndefined()
})
