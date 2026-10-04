// @vitest-environment jsdom
/**
 * ReferenceChip visual face: icon selection per appearance, the trigger
 * marker fallback, label truncation container, and invalid styling.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ReferenceChip } from '../src/client/input/editor/ReferenceChip.tsx'

afterEach(cleanup)

describe('ReferenceChip', () => {
  it('renders the domain icon and the label', () => {
    const { container, getByText } = render(
      <ReferenceChip label="Research notes" rawText="@[Research notes](dsh-session:InNvdXJjZSI)" appearance="session" invalid={false} />,
    )
    expect(getByText('Research notes')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toBe('Research notes')
  })

  it('falls back to the trigger marker without an appearance', () => {
    const { container } = render(<ReferenceChip label="commit-helper" rawText="@commit-helper" invalid={false} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('@commit-helper')
  })

  it('shows the exact raw reference in the shared message-style tooltip without duplicating the draft label', async () => {
    const rawText = '@[Research notes](dsh-session:InNvdXJjZSI)'
    const view = render(<ReferenceChip label="Research notes" rawText={rawText} appearance="session" invalid={false} />)
    fireEvent.mouseEnter(view.getByText('Research notes').parentElement!)
    await waitFor(() => { expect(view.getByText(rawText)).toBeTruthy() })
    expect(view.container.textContent).toBe('Research notes')
    expect(view.container.contains(view.getByText(rawText))).toBe(false)
    expect(view.getByRole('tooltip').style.maxWidth).toBe('480px')
    fireEvent.mouseLeave(view.getByText('Research notes').parentElement!)
    expect(view.queryByText(rawText)).toBeNull()
  })

  it('applies the invalid styling bit', () => {
    const { container } = render(<ReferenceChip label="gone" rawText="@gone/" appearance="folder" invalid />)
    const chip = container.querySelector('[class*="invalid"]')
    expect(chip).not.toBeNull()
    expect([...(chip?.classList ?? [])].some(name => name.includes('invalid'))).toBe(true)
  })
})
