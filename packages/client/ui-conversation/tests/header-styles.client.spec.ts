/** Conversation header shell style contracts (the Electron drag-title contract). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('ConversationRoot.module.css', () => {
  it('makes the header title row the Electron top drag target, seats no-drag', () => {
    expect(declarations(":global(html[data-shell^='electron-']) .header .titleRow")?.get('-webkit-app-region'))
      .toBe('drag')
    for (const seat of ['button', '.headerActions', '.headerUtilities', '.headerCorner']) {
      expect(
        declarations(`:global(html[data-shell^='electron-']) .header .titleRow ${seat}`)?.get('-webkit-app-region'),
      ).toBe('no-drag')
    }
  })
})
