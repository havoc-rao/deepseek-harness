// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { questionHotkeys, type HotkeyService } from '../src/client/hotkeys.ts'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

type Action = Parameters<HotkeyService['registerAction']>[0]
const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  cleanup()
  document.body.replaceChildren()
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
})

async function setup(late = false) {
  const ctx = new Context()
  const actions = new Map<string, Action>()
  const registerAction = vi.fn((action: Action) => {
    actions.set(action.id, action)
    return () => { actions.delete(action.id) }
  })
  const releaseScope = vi.fn()
  const activateScope = vi.fn(() => releaseScope)
  let provider: ReturnType<Context['plugin']> | undefined
  const provide = async () => {
    provider = ctx.plugin((scope: Context) => { scope.provide('hotkey', { registerAction, activateScope }) })
    disposers.push(async () => { await provider?.dispose() })
    await provider.await()
  }
  if (!late) await provide()
  let register: ReturnType<typeof questionHotkeys> | undefined
  const fiber = ctx.plugin((scope: Context) => { register = questionHotkeys(scope) })
  disposers.push(async () => { await fiber.dispose() })
  await fiber.await()
  if (!late) await vi.waitFor(() => { expect(actions.size).toBe(11) })
  const seat = () => {
    const element = document.createElement('div')
    element.getClientRects = () => ({ length: 1 }) as DOMRectList
    document.body.append(element)
    const run = vi.fn(() => true)
    const dispose = register!(element, run)
    return { element, run, dispose }
  }
  return { actions, seat, fiber, registerAction, activateScope, releaseScope, provide,
    removeProvider: async () => { await provider?.dispose() } }
}

describe('question owner hotkeys', () => {
  it('releases active scopes when the hotkey service unloads before the question owner', async () => {
    const { actions, seat, removeProvider, releaseScope } = await setup()
    const current = seat()
    await removeProvider()
    await vi.waitFor(() => { expect(actions.size).toBe(0) })
    expect(releaseScope).toHaveBeenCalledOnce()
    current.dispose()
    expect(releaseScope).toHaveBeenCalledOnce()
  })

  it('activates existing seats when the optional service arrives and releases them on unload', async () => {
    const { actions, seat, fiber, activateScope, releaseScope, provide } = await setup(true)
    seat()
    expect(activateScope).not.toHaveBeenCalled()
    await provide()
    await vi.waitFor(() => { expect(actions.size).toBe(11) })
    expect(activateScope).toHaveBeenCalledWith('question')
    await fiber.dispose()
    expect(releaseScope).toHaveBeenCalledOnce()
    expect(actions.size).toBe(0)
  })

  it('registers stable actions once and withdraws them with the owner', async () => {
    const { actions, seat, fiber, registerAction, activateScope, releaseScope } = await setup()
    expect(activateScope).not.toHaveBeenCalled()
    const current = seat()
    expect(activateScope).toHaveBeenCalledWith('question')
    expect(actions.get('question.cancel')).toMatchObject({ scope: 'question', priority: 100 })
    expect(actions.get('question.submit')?.def).toBe('ctrl+enter')
    expect(actions.get('question.cancel')?.def).toBe('escape')
    expect(actions.get('question.option.3')?.def).toBe('3')
    expect(registerAction).toHaveBeenCalledTimes(11)
    expect(actions.get('question.submit')?.run({})).toBe(true)
    expect(current.run).toHaveBeenCalledWith('submit')
    current.dispose()
    expect(releaseScope).toHaveBeenCalledOnce()
    current.dispose()
    expect(releaseScope).toHaveBeenCalledOnce()
    expect(actions.get('question.submit')?.available()).toBe(false)
    expect(actions.get('question.submit')?.run({})).toBe(false)
    await fiber.dispose()
    expect(actions.size).toBe(0)
  })

  it('requires an unambiguous visible seat or focus in that seat', async () => {
    const { actions, seat } = await setup()
    const first = seat()
    const second = seat()
    const action = actions.get('question.option.1')!
    expect(action.run({})).toBe(false)
    const button = document.createElement('button')
    second.element.append(button)
    button.focus()
    expect(action.run({})).toBe(true)
    expect(first.run).not.toHaveBeenCalled()
    expect(second.run).toHaveBeenCalledWith(1)
    second.element.remove()
    expect(action.run({})).toBe(true)
    expect(first.run).toHaveBeenCalledWith(1)
    first.element.getClientRects = () => ({ length: 0 }) as DOMRectList
    expect(action.run({})).toBe(false)
  })

  it('leaves numeric text input alone but allows explicit submit and cancel', async () => {
    const { actions, seat } = await setup()
    const current = seat()
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag)
      current.element.append(field)
      field.focus()
      expect(actions.get('question.option.2')?.run({})).toBe(false)
      expect(actions.get('question.submit')?.run({})).toBe(true)
      expect(actions.get('question.cancel')?.run({})).toBe(true)
      field.remove()
    }
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    current.element.append(editable)
    editable.focus()
    expect(actions.get('question.option.2')?.run({})).toBe(false)
  })

  it('yields to a foreground modal and leaves a declined owner action untouched', async () => {
    const { actions, seat } = await setup()
    const current = seat()
    current.run.mockReturnValue(false)
    expect(actions.get('question.submit')?.run({})).toBe(false)
    current.run.mockClear()
    render(createElement(Modal, { open: true, title: 'Foreground', closeLabel: 'Close', onClose: () => {} }))
    expect(actions.get('question.cancel')?.run({ event: new KeyboardEvent('keydown', { key: 'Escape' }) })).toBe(false)
    expect(current.run).not.toHaveBeenCalled()
  })

  it('does not consume repeat, composing or already handled events', async () => {
    const { actions, seat } = await setup()
    const current = seat()
    const action = actions.get('question.submit')!
    for (const init of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) {
      expect(action.run({ event: new KeyboardEvent('keydown', init) })).toBe(false)
    }
    const event = new KeyboardEvent('keydown', { cancelable: true })
    event.preventDefault()
    expect(action.run({ event })).toBe(false)
    expect(current.run).not.toHaveBeenCalled()
  })
})
