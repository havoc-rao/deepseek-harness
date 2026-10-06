/** Keyless fixture loaded only as an overlay of the supported headless profile. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'

const OWNER = '@fixture/observability-smoke'
const TEXT = 'OBSERVABILITY_PROFILE_SMOKE_OK'

class SmokeRemote extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'observationSmoke') }
  echo(): string { return TEXT }
}

class SmokeAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (!options.messages.some(message => message.role === 'tool')) {
      const id = ToolCallId('observation-smoke-tool')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'observation_smoke', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'observation_smoke', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: TEXT }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: TEXT } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'observability-profile-smoke'
export const inject = ['llm', 'tools', 'typert', 'typertGateway', 'observability']

/** Register deterministic model/tool work and readiness for the one-shot runner. */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(SmokeRemote)
  ctx.typert.register({
    package: OWNER, face: 'host', schemas: [], model: { services: [], events: [], objects: [] },
    invocations: [{
      id: 'observation-smoke-echo', service: 'observationSmoke', namespace: 'observationSmoke', method: 'echo',
      invocation: { kind: 'direct' }, parameters: [], result: { mode: 'src-json' },
    }],
  })
  ctx.llm.registerAdapter(['observation-smoke'], new SmokeAdapter(), { telemetryOwner: OWNER })
  ctx.tools.register(defineContentToolFixture({
    name: 'observation_smoke',
    description: 'Return the deterministic smoke marker.',
    parameters: {},
    telemetryOwner: OWNER,
    async execute() {
      const value = await ctx.typertGateway.invoke({ namespace: 'observationSmoke', method: 'echo', args: {} })
      if (value !== TEXT) throw new Error('Gateway smoke response mismatch')
      return [{ type: 'text', text: value }]
    },
  }))
  ctx.provide('observabilitySmokeReady', true)
}
