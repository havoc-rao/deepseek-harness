import { TerminalFrameOpcode } from '@deepseek-ai/dsh-terminal-protocol'
import { describe, expect, it } from 'vitest'

describe('debug import', () => {
  it('resolves the enum', () => {
    expect(typeof TerminalFrameOpcode).not.toBe('undefined')
    expect(TerminalFrameOpcode.Open).toBe(1)
  })
})
