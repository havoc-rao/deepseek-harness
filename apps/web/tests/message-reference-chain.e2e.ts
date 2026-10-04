/** Optional reference presenters reach sent messages and cold queues through the shipped Web composition. */
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, readPersistedEvents,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const BUNDLE = fileURLToPath(new URL('./fixtures/plugins/fixture-reference-chain', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/message-reference-chain.expected.md', import.meta.url))
const SESSION_ID = SessionId('message-reference-chain-web-e2e')
const MESSAGE = 'Sent @external/opaque and @folder/notes.md'
const QUEUED_TOKEN = `@external/${'a'.repeat(250)}`
const QUEUED = `Queued ${QUEUED_TOKEN} and @folder/notes.md`

it('renders a contributed reference label in a message and queue while retaining unclaimed file references', async () => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: BUNDLE, enabled: true }] } })
  resources.scaffold = scaffold
  const createdAt = Date.now() - 60_000
  const session = Session.create(SESSION_ID)
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: MESSAGE }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('agent/inbox/spliced', {
    target: 'next-turn', start: 0,
    inserted: [createUserMessage({ content: [{ type: 'text', text: QUEUED }], source: { kind: 'user' } })],
  })
  const handle = await scaffold.ctx.sessionPersistence.create({
    version: SESSION_FORMAT_VERSION, id: SESSION_ID, createdAt,
    cwd: scaffold.workspaceCwd, isSeeded: false, delegationDepth: 0,
  })
  try { await handle.append(session.snapshotEvents()) } finally { await handle.close() }
  expect(scaffold.ctx.agents.get(SESSION_ID)).toBeUndefined()

  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-message-reference-chain'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  const group = page.locator('[role="treeitem"]').first()
  await group.waitFor({ timeout: 15_000 })
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  await page.locator('[role="treeitem"]').nth(1).click()

  const message = page.locator('[data-chat-flow-kind="user"]').filter({ hasText: 'Sent' })
  const queue = page.locator('[data-queue-dock]')
  await message.locator('[data-external-reference]').waitFor({ timeout: 15_000 })
  await queue.locator('[data-external-reference]').waitFor({ timeout: 15_000 })
  for (const surface of [message, queue]) {
    expect(await surface.locator('[data-external-reference]').allTextContents()).toEqual(['External project'])
    expect(await surface.innerText()).not.toContain('@external/')
    const fallback = surface.locator('[data-ref-chip="file"]')
    expect(await fallback.textContent()).toBe('notes.md')
    expect(await fallback.getAttribute('title')).toBe('@folder/notes.md')
  }
  const composer = page.locator('[data-composer-input]')
  const dropTarget = page.locator('[data-reference-drop-target]')
  // Decorator spans add layout newlines to innerText, but not to the draft's DOM text.
  const draftText = async () => (await composer.textContent())?.replaceAll('\u00a0', ' ')
  const draftOrder: string[] = []
  const dropReference = async () => {
    const oldRange = await composer.evaluateHandle((element) => {
      const selection = element.ownerDocument.getSelection()
      if (selection?.rangeCount !== 1) throw new Error('Composer selection missing before sidebar mousedown')
      return selection.getRangeAt(0).cloneRange()
    })
    try {
      // A sidebar mousedown takes focus away while the browser retains the old caret.
      await group.hover()
      await page.mouse.down()
      await dropTarget.hover()
      await page.mouse.up()
      await oldRange.evaluate((range) => {
        const selection = document.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      })
      await composer.evaluate((element) => { (element as HTMLElement).blur() })
      await dropTarget.focus()
      expect(await composer.evaluate(element => element === document.activeElement)).toBe(false)
      expect(await composer.evaluate(element => element.contains(document.getSelection()?.anchorNode ?? null))).toBe(true)
      const transfer = await page.evaluateHandle(() => {
        const data = new DataTransfer()
        data.setData('application/x-reference-chain', '@external/opaque')
        return data
      })
      try {
        await dropTarget.dispatchEvent('dragover', { dataTransfer: transfer })
        await dropTarget.dispatchEvent('drop', { dataTransfer: transfer })
      } finally { await transfer.dispose() }
      await expect.poll(() => composer.evaluate(element => element === document.activeElement)).toBe(true)
    } finally { await oldRange.dispose() }
  }
  const assertOrder = async (name: string, expected: string) => {
    const actual = await draftText()
    expect.soft(actual, `${name}: text typed after the newly dropped chip`).toBe(expected)
    draftOrder.push(`- ${name}: ${actual}`)
  }

  await composer.fill('existing tail')
  await page.keyboard.press('Home')
  await dropReference()
  await page.keyboard.type('after start ')
  await assertOrder('Draft start', 'External project after start existing tail')

  await composer.fill('left right')
  await page.keyboard.press('Home')
  for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowRight')
  await dropReference()
  await page.keyboard.type('after middle ')
  await assertOrder('Draft middle', 'left External project after middle right')

  await composer.fill('prefix ')
  await page.keyboard.press('End')
  await dropReference()
  await dropReference()
  await page.keyboard.type('after consecutive ')
  await assertOrder('Consecutive chips', 'prefix External project External project after consecutive ')
  expect(await composer.locator('[data-composer-chip]').allTextContents()).toEqual(['External project', 'External project'])
  await page.reload({ waitUntil: 'load' })
  await expect.poll(() => composer.locator('[data-composer-chip]').count()).toBe(2)
  await assertOrder('Restored draft', 'prefix External project External project after consecutive ')
  expect(await composer.innerText()).not.toContain('@external/')

  const chip = composer.locator('[data-composer-chip]').last()
  const tooltip = page.getByRole('tooltip', { includeHidden: true }).filter({ hasText: /^@external\/opaque$/ })
  const restoredText = await draftText()
  await page.mouse.move(0, 0)
  await page.clock.install()
  await page.clock.pauseAt(await page.evaluate(() => Date.now()))
  try {
    await chip.hover()
    expect(await tooltip.count()).toBe(0)
    await page.clock.runFor(499)
    expect(await tooltip.count()).toBe(0)
    await page.clock.runFor(1)
    expect(await tooltip.count()).toBe(1)
  } finally { await page.clock.resume() }
  await tooltip.waitFor({ state: 'visible' })
  expect(await tooltip.textContent()).toBe('@external/opaque')
  expect(await tooltip.evaluate(element => ({
    portal: element.parentElement === document.body,
    inComposer: document.querySelector('[data-composer-input]')?.contains(element),
    maxWidth: getComputedStyle(element).maxWidth,
    pointerEvents: getComputedStyle(element).pointerEvents,
  }))).toEqual({ portal: true, inComposer: false, maxWidth: '480px', pointerEvents: 'none' })
  expect(await draftText()).toBe(restoredText)
  const hoverSnapshot = await tooltip.textContent()
  const tooltipBox = await tooltip.boundingBox()
  expect(tooltipBox).not.toBeNull()
  await page.mouse.move(tooltipBox!.x + tooltipBox!.width / 2, tooltipBox!.y + tooltipBox!.height / 2)
  await tooltip.waitFor({ state: 'detached' })
  expect(await draftText()).toBe(restoredText)

  const viewport = page.viewportSize()!
  const themes: string[] = []
  try {
    await page.setViewportSize({ width: 480, height: 640 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(colorScheme === 'dark' ? '' : null)
      await page.mouse.move(0, 0)
      await chip.hover()
      await tooltip.waitFor({ state: 'visible' })
      await expect.poll(() => tooltip.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.width <= 480
          && rect.left >= 12 && rect.right <= innerWidth - 12
          && rect.top >= 12 && rect.bottom <= innerHeight - 12
      })).toBe(true)
      expect(await tooltip.textContent()).toBe('@external/opaque')
      await expect.poll(() => tooltip.evaluate(element => getComputedStyle(element).opacity)).toBe('1')
      const paint = await tooltip.evaluate((element) => {
        const style = getComputedStyle(element)
        return { color: style.color, background: style.backgroundColor, opacity: style.opacity, visibility: style.visibility }
      })
      expect(paint.opacity).toBe('1')
      expect(paint.visibility).toBe('visible')
      expect(paint.color).not.toBe(paint.background)
      expect(paint.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(await draftText()).toBe(restoredText)
      themes.push(`- ${colorScheme}: visible, max-480px viewport-contained tooltip`)
      await page.mouse.move(0, 0)
      await tooltip.waitFor({ state: 'detached' })
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize(viewport)
  }

  const snapshot = [
    '# Sent message', await captureStableAria(page, '[data-chat-flow-kind="user"]', scaffold.workspaceCwd),
    '# Queued message', await captureStableAria(page, '[data-queue-dock]', scaffold.workspaceCwd),
    '# Draft reference order', ...draftOrder.map(line => line.trimEnd()),
    '# Restored composer references', ...(await composer.locator('[data-composer-chip]').allTextContents()).map(label => `- ${label}`),
    '# Composer reference hover', '```text', hoverSnapshot, '```',
    '- Exact raw text appears in a role=tooltip body portal after 500ms; composer text is unchanged',
    '- Pointer events are disabled; leaving the chip for the tooltip dismisses it',
    ...themes,
  ].join('\n')
  expect(snapshot).toContain('External project')
  expect(snapshot).toContain('notes.md')
  expect(snapshot).toContain('```text\n@external/opaque\n```')
  await compareOrRefreshGolden(EXPECTED, snapshot, webSnapshotMode())

  const events = await readPersistedEvents(scaffold, SESSION_ID)
  expect(events.filter(event => event.type === 'user/message').map(event => event.data.content))
    .toEqual([[{ type: 'text', text: MESSAGE }]])
  expect(JSON.stringify(events.find(event => event.type === 'agent/inbox/spliced')?.data)).toContain(QUEUED)
  expect(events.some(event => event.type === 'request/header')).toBe(false)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
