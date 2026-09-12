import { describe, expect, it } from 'vitest'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { opencodeSessionHeaders } from '../src/opencode-session.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('opencodeSessionHeaders', () => {
  it('sends the request session id to the OpenCode gateway host', () => {
    expect(opencodeSessionHeaders('custom-route', 'https://opencode.ai/zen/go/v1', 'session-1'))
      .toEqual({ 'x-opencode-session': 'session-1' })
  })

  it('matches OpenCode gateway subdomains', () => {
    expect(opencodeSessionHeaders('custom-route', 'https://api.opencode.ai/v1', 'session-1'))
      .toEqual({ 'x-opencode-session': 'session-1' })
  })

  it('sends the request session id on the installed OpenCode routes', () => {
    const model = getBuiltinModels('opencode-go').find(entry => entry.api === 'openai-completions')
    if (model === undefined) throw new Error('the installed catalog ships no opencode-go completions model')
    expect(opencodeSessionHeaders('opencode-go', model.baseUrl, 'session-1'))
      .toEqual({ 'x-opencode-session': 'session-1' })
  })

  it('generates a session id when the request names none', () => {
    const headers = opencodeSessionHeaders('opencode', undefined, undefined)
    expect(headers['x-opencode-session']).toMatch(UUID)
  })

  it('leaves other routes untouched', () => {
    expect(opencodeSessionHeaders('deepseek', 'https://api.deepseek.com/v1', 'session-1')).toEqual({})
    expect(opencodeSessionHeaders('deepseek', undefined, 'session-1')).toEqual({})
  })

  it('treats an endpoint it cannot parse as outside the gateway', () => {
    expect(opencodeSessionHeaders('custom-route', 'not a url', 'session-1')).toEqual({})
  })

  it('lets a deployment-configured header win', () => {
    expect(opencodeSessionHeaders('opencode-go', undefined, 'session-1', { 'X-Opencode-Session': 'pinned' }))
      .toEqual({})
    expect(opencodeSessionHeaders('opencode-go', undefined, 'session-1', { 'x-company': 'private' }))
      .toEqual({ 'x-opencode-session': 'session-1' })
  })
})
