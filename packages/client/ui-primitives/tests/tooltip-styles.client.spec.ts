/** CSS Modules are mocked in component tests; these checks pin owner styling for unstyled hint providers. */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/Tooltip.module.css', import.meta.url), 'utf8')

it('owns hint typography and layout without provider element styles', () => {
  const hint = /\.hint\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  for (const declaration of [
    'display: inline-flex', 'flex: none', 'align-items: center', 'color: inherit',
    'font-family: inherit', 'font-size: 11px', 'font-weight: 400', 'line-height: 16px',
    'white-space: nowrap', 'pointer-events: none', 'user-select: none',
  ]) expect(hint).toContain(declaration)
  const bubble = /\.bubble\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(bubble).toContain('color: var(--dsw-static-neutral-bluish-00)')
  expect(bubble).toContain('gap: 8px')
  expect(css).toContain('.hint:empty { display: none; }')
  expect(css).not.toMatch(/\.hint\s+(?:kbd|span)/)
  expect(hint).not.toMatch(/opacity\s*:/)
})

it.each(['light', 'dark'])('keeps unstyled shortcut text the same color and opacity as the label in %s mode', (theme) => {
  const dom = new JSDOM(`<!doctype html><html data-theme="${theme}"><head><style>
    :root { --dsw-static-neutral-bluish-00: rgb(255, 255, 255); }
    ${css.replaceAll('var(--dsw-static-neutral-bluish-00)', 'rgb(255, 255, 255)')}
  </style></head><body><span class="bubble" role="tooltip">
    <span class="label">New tab</span>
    <span class="hint" data-tooltip-hint><span data-dsh-hotkey-hint="new.tab">⇧⌘N</span></span>
  </span></body></html>`)
  try {
    const label = dom.window.document.querySelector('.label')!
    const labelStyle = dom.window.getComputedStyle(label)
    expect(labelStyle.color).toBe('rgb(255, 255, 255)')
    for (const selector of ['.hint', '[data-dsh-hotkey-hint]']) {
      const node = dom.window.document.querySelector(selector)!
      const style = dom.window.getComputedStyle(node)
      expect(style.color).toBe(labelStyle.color)
      expect(style.opacity || '1').toBe(labelStyle.opacity || '1')
    }
  } finally {
    dom.window.close()
  }
})
