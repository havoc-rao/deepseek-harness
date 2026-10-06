/** An ephemeral loopback collector verifies the actual HTTP/protobuf exporters. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'
import { ObservabilityRuntime } from '../src/runtime.ts'

it('exports separate standard trace and metric protobuf requests without logs', async () => {
  const captures: { path: string | undefined; type: string | undefined; body: Buffer }[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      captures.push({ path: request.url, type: request.headers['content-type'], body: Buffer.concat(chunks) })
      response.writeHead(200, { 'content-type': 'application/x-protobuf' })
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let runtime: ObservabilityRuntime | undefined
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP address')
    runtime = await ObservabilityRuntime.create(resolveConfig({ enabled: true, endpoint: `http://127.0.0.1:${address.port}`, collection: { default: { traces: true, metrics: true } } }, {}))
    runtime.run('@example/plugin', 'transport.check', () => 42)
    await runtime.forceFlush()
    expect(new Set(captures.map(value => value.path))).toEqual(new Set(['/v1/traces', '/v1/metrics']))
    for (const capture of captures) {
      expect(capture.type).toBe('application/x-protobuf')
      expect(capture.body.length).toBeGreaterThan(0)
      expect(capture.body[0]).not.toBe('{'.charCodeAt(0))
      expect(capture.body.includes(Buffer.from('@example/plugin'))).toBe(true)
    }
  } finally {
    await runtime?.shutdown()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  }
})
