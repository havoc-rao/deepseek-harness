// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceLogoInjected } from '../src/client/index.ts'
import { WorkspaceHoverLogo, WorkspaceLogoCell, WorkspaceLogoMenuEntry } from '../src/client/logo.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never
const wid = (id: string) => id as WorkspaceId

function cellProps(
  overrides: Partial<PropsRuntime<'sidebar.workspaces.workspaceIcon'>> = {},
): PropsRuntime<'sidebar.workspaces.workspaceIcon'> {
  return {
    workspaceId: wid('w1'), label: 'W', logo: undefined, expanded: true, containsCurrent: false,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    ...overrides,
  }
}

function menuProps(
  overrides: Partial<PropsRuntime<'sidebar.workspaces.workspaceMenu'> & WorkspaceLogoInjected> = {},
): PropsRuntime<'sidebar.workspaces.workspaceMenu'> & WorkspaceLogoInjected {
  return {
    workspaceId: wid('w1'), label: 'W', menuOpen: false,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    pick: vi.fn(),
    t,
    ...overrides,
  }
}

describe('workspace logo surface', () => {
  it('renders the host logo in the leading cell and falls back to the folder glyph', () => {
    const dataUrl = 'data:image/png;base64,abc'
    const view = render(<WorkspaceLogoCell {...cellProps({ logo: dataUrl })} />)
    const img = view.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe(dataUrl)
    // Decorative beside the row title; never intercepts the row's own drag.
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('draggable')).toBe('false')
    // A broken source falls back to the folder glyph.
    fireEvent.error(img as Element)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('svg')).toBeTruthy()
  })

  it('keeps the folder glyph while no logo is recorded', () => {
    const closed = render(<WorkspaceLogoCell {...cellProps({ expanded: false })} />)
    expect(closed.container.querySelector('img')).toBeNull()
    const open = render(<WorkspaceLogoCell {...cellProps({ expanded: true })} />)
    expect(open.container.querySelector('img')).toBeNull()
    expect(open.container.querySelector('svg')).toBeTruthy()
  })

  it('menu entry opens the picker and commits the picked image as a data URL', async () => {
    const pick = vi.fn()
    const view = render(<WorkspaceLogoMenuEntry {...menuProps({ pick })} />)
    const button = screen.getByRole('button', { name: '添加 logo 图片' })
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input?.getAttribute('accept')).toBe('image/*')
    const open = vi.spyOn(input as HTMLInputElement, 'click')
    fireEvent.click(button)
    expect(open).toHaveBeenCalledOnce()

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['logo-bytes'], 'logo.png', { type: 'image/png' })] },
    })
    await waitFor(() => { expect(pick).toHaveBeenCalledOnce() })
    const [workspaceId, dataUrl] = pick.mock.calls[0] as [WorkspaceId, string]
    expect(workspaceId).toBe('w1')
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('menu picker warns on missing, non-image, and oversized files, accepts the next valid pick', async () => {
    const pick = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const view = render(<WorkspaceLogoMenuEntry {...menuProps({ pick })} />)
      const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!
      fireEvent.change(input, { target: { files: [] } })
      fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
      fireEvent.change(input, { target: { files: [new File(['x'], 'mystery.bin', { type: '' })] } })
      fireEvent.change(input, {
        target: { files: [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })] },
      })
      // The input is reset after every attempt, so the same file can be re-picked.
      expect(input.value).toBe('')
      expect(pick).not.toHaveBeenCalled()
      expect(warn.mock.calls.length).toBeGreaterThanOrEqual(4)
      fireEvent.change(input, { target: { files: [new File(['ok'], 'ok.png', { type: 'image/png' })] } })
      await waitFor(() => { expect(pick).toHaveBeenCalledOnce() })
    } finally {
      warn.mockRestore()
    }
  })

  it('menu picker warns when the raw image exceeds the stored data-URL cap (no canvas in jsdom)', async () => {
    const pick = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const view = render(<WorkspaceLogoMenuEntry {...menuProps({ pick })} />)
      const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!
      // ~3 MiB of image pixels: a raw data URL well past the 2_800_000 wire cap.
      fireEvent.change(input, {
        target: { files: [new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })] },
      })
      await waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('exceeds the data-URL cap')) })
      expect(pick).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('hover card header shows the card-sized logo only while one is recorded', () => {
    const withLogo = render(<WorkspaceHoverLogo {...cellProps({ logo: 'data:image/png;base64,abc' })} />)
    const img = withLogo.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,abc')
    const bare = render(<WorkspaceHoverLogo {...cellProps({ logo: undefined })} />)
    expect(bare.container.querySelector('img')).toBeNull()
  })
})
