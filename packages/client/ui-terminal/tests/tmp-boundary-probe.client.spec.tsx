// @vitest-environment jsdom
// Temporary probe: does a useEffect cleanup error thrown during unmount reach
// a class error boundary in React 18? If yes, a cleanup throw inside
// TerminalView would abdicate the shell.overlay slot entry (toggle disappears).

import { act, render, screen } from '@testing-library/react'
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

class Boundary extends Component<
  { onError: (error: Error, info: ErrorInfo) => void; children?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info)
  }
  render(): ReactNode {
    return this.state.failed ? <div>crashed</div> : this.props.children
  }
}

function Boom(): ReactNode {
  const [show, setShow] = useState(true)
  useEffect(() => {
    return () => {
      throw new Error('cleanup boom')
    }
  }, [])
  return show ? <button onClick={() => setShow(false)}>close</button> : null
}

describe('react error boundary behavior probe', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('useEffect cleanup throw during unmount reaches the boundary', () => {
    const onError = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <Boundary onError={onError}>
        <Boom />
      </Boundary>,
    )
    act(() => {
      screen.getByRole('button', { name: 'close' }).click()
    })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    errorSpy.mockRestore()
  })
})
