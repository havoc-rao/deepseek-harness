/** Supported public headless launch with keyless model, tool, and Gateway operations. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

it('exports real headless profile model tool and Gateway operations', async () => {
  const bodies: Buffer[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks))
      response.writeHead(200, { 'content-type': 'application/x-protobuf' })
      response.end()
    })
  })
  onTestFinished(async () => {
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  })
  const external = process.env.DSH_OBSERVABILITY_TEST_ENDPOINT
  let endpoint = external
  if (endpoint === undefined) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected TCP collector address')
    endpoint = `http://127.0.0.1:${address.port}`
  }
  const configPath = fileURLToPath(new URL('./fixtures/headless-smoke.patch.yml', import.meta.url))
  const { stdout } = await runLoaderSmoke({
    label: 'observability-profile', tempDirPrefix: 'dsh-observability-profile-',
    binScript: fileURLToPath(new URL('../../../../apps/cli/src/bin.ts', import.meta.url)),
    configPath,
    binArgs: ['--profile', 'headless', '--patch', configPath, 'Run the observation smoke tool and finish.'],
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    sourceImport: 'tsx/esm', processTimeoutMs: 60000,
    env: { DSH_OBSERVABILITY_TEST_ENDPOINT: endpoint, DEEPSEEK_API_KEY: undefined },
  })
  expect(stdout).toContain('OBSERVABILITY_PROFILE_SMOKE_OK')
  if (external === undefined) {
    const exported = Buffer.concat(bodies)
    expect(exported.includes(Buffer.from('dsh-observability-profile-smoke'))).toBe(true)
    expect(exported.includes(Buffer.from('llm.stream.observation-smoke'))).toBe(true)
    expect(exported.includes(Buffer.from('observation_smoke'))).toBe(true)
    expect(exported.includes(Buffer.from('gateway.invoke observationSmoke/echo'))).toBe(true)
    expect(exported.includes(Buffer.from('OBSERVABILITY_PROFILE_SMOKE_OK'))).toBe(false)
  }
}, 75000)
