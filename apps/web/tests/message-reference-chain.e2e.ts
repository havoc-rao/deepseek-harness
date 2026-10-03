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
  const snapshot = [
    '# Sent message', await captureStableAria(page, '[data-chat-flow-kind="user"]', scaffold.workspaceCwd),
    '# Queued message', await captureStableAria(page, '[data-queue-dock]', scaffold.workspaceCwd),
  ].join('\n')
  expect(snapshot).toContain('External project')
  expect(snapshot).toContain('notes.md')
  expect(snapshot).not.toContain('@external/')
  await compareOrRefreshGolden(EXPECTED, snapshot, webSnapshotMode())

  const events = await readPersistedEvents(scaffold, SESSION_ID)
  expect(events.filter(event => event.type === 'user/message').map(event => event.data.content))
    .toEqual([[{ type: 'text', text: MESSAGE }]])
  expect(JSON.stringify(events.find(event => event.type === 'agent/inbox/spliced')?.data)).toContain(QUEUED)
  expect(events.some(event => event.type === 'request/header')).toBe(false)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
