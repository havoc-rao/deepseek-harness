// @vitest-environment jsdom
/** Right-panel width row: live mirror display, stepper writes, and bounds. */

import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createRightPanelWidthRowStore } from '../src/client/settings/right-panel-width-store.ts'
import { RightPanelWidthRow, WIDTH_STEP } from '../src/client/settings/RightPanelWidthRow.tsx'
import type { RightPanelWidthRowComponentProps } from '../src/client/settings/RightPanelWidthRow.tsx'

afterEach(() => { cleanup() })

function mount(width: number, max: number) {
  const handle = createRightPanelWidthRowStore()
  const instance = handle.create()
  const setRightbarWidth = vi.fn()
  const props = {
    useStore: bindSnapshotSelector(instance),
    t: (key: string) => key,
    setRightbarWidth,
  } as unknown as RightPanelWidthRowComponentProps
  const view = render(<RightPanelWidthRow {...props} />)
  act(() => { instance.actions.sync(width, max) })
  return { ...view, instance, setRightbarWidth }
}

function stepper(view: ReturnType<typeof mount>) {
  return {
    increase: view.getByRole('button', { name: 'rightPanelWidth.increase' }) as HTMLButtonElement,
    decrease: view.getByRole('button', { name: 'rightPanelWidth.decrease' }) as HTMLButtonElement,
  }
}

describe('RightPanelWidthRow', () => {
  it('shows the live width and steps in tens of px within the frame bounds', () => {
    const view = mount(420, 1344)
    expect(view.getByText('420')).toBeTruthy()
    const { increase, decrease } = stepper(view)
    act(() => { increase.click() })
    expect(view.setRightbarWidth).toHaveBeenCalledWith(420 + WIDTH_STEP)
    act(() => { decrease.click() })
    expect(view.setRightbarWidth).toHaveBeenCalledWith(420 - WIDTH_STEP)
  })

  it('disables the stepper at the frame bounds', () => {
    const lower = mount(300, 300)
    expect(stepper(lower).increase.disabled).toBe(true)
    expect(stepper(lower).decrease.disabled).toBe(true)
    act(() => { stepper(lower).increase.click() })
    act(() => { stepper(lower).decrease.click() })
    expect(lower.setRightbarWidth).not.toHaveBeenCalled()
    lower.unmount()
    const wide = mount(1344, 1344)
    expect(stepper(wide).increase.disabled).toBe(true)
    act(() => { stepper(wide).increase.click() })
    expect(wide.setRightbarWidth).not.toHaveBeenCalled()
  })

  it('follows the mirror as the width drags and the frame resizes', () => {
    const view = mount(864, 1344)
    act(() => { view.instance.actions.sync(500, 1344) })
    expect(view.getByText('500')).toBeTruthy()
    expect(stepper(view).increase.disabled).toBe(false)
    // A frame too narrow for the width disables widening until the user drags.
    act(() => { view.instance.actions.sync(500, 490) })
    expect(stepper(view).increase.disabled).toBe(true)
  })
})
