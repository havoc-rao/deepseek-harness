import type { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { installInjectionPublisher } from '../src/injections.ts'

it('publishes fresh boot injections whenever the client graph recomposes', () => {
  const listeners: (() => void)[] = []
  const ctx = {
    get: (name: string) => name === 'clientModules'
      ? { onGraphChanged: (listener: () => void): (() => void) => { listeners.push(listener); return () => {} } }
      : undefined,
    webServer: { collectIndexInjections: () => [{ kind: 'global', name: 'x', value: 'y' }] },
  } as unknown as Context
  const sent: object[] = []
  installInjectionPublisher(ctx, (message) => { sent.push(message) })

  expect(sent).toEqual([])
  expect(listeners).toHaveLength(1)
  listeners[0]!()
  expect(sent).toEqual([{ type: 'injections', injections: [{ kind: 'global', name: 'x', value: 'y' }] }])
  listeners[0]!()
  expect(sent).toHaveLength(2)
})

it('stays silent when the composition provides no client module registry', () => {
  const sent: object[] = []
  installInjectionPublisher({ get: () => undefined } as unknown as Context, (message) => { sent.push(message) })
  expect(sent).toEqual([])
})
