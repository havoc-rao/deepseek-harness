/**
 * Unit tests for the desktop-shell marker (apps/electron/src/shell.ts). Pure
 * main-process logic without an Electron runtime: the provide function's
 * contract is the registered marker and its key.
 */
import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_SHELL_KEY, provideDesktopShell } from '../src/shell.ts'

describe('provideDesktopShell', () => {
  it('registers the marker as true under the desktopShell key', () => {
    const provide = vi.fn()
    provideDesktopShell({ provide } as never)
    expect(provide).toHaveBeenCalledWith(DESKTOP_SHELL_KEY, true)
  })
})
