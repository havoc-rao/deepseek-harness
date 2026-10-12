// Session-header background jobs driven by a real `ctx.jobs` entry. No model
// call is involved.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobId, type JobHandle, type JobOutcome } from '@deepseek-ai/dsh-jobs'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/background-job-list', import.meta.url))
const RUNNING_EXPECTED = join(SNAPSHOT_DIR, 'running.expected.md')
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'background-job-list-web-e2e'
// A hold on a barrier file the test owns in the job's cwd: the process never
// exits on its own, so no CI stall can settle it before the scenario kills it.
// The bounded loop only caps an orphan's lifetime if the runner dies before
// `afterAll` releases the barrier.
const RELEASE = '.background-job-list.release'
const COMMAND = `for _ in $(seq 1 3000); do [ -e ${RELEASE} ] && break; sleep 0.2; done`

/**
 * Wait for opening a session to publish its live Agent.
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
async function liveAgent(scaffold: WebScaffold, sessionId: SessionId): Promise<Agent> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = scaffold.ctx.agents.get(sessionId)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`opening session "${sessionId}" published no live Agent`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe.skipIf(MODE === 'record')('web e2e: background job list', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agent: Agent

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    // Opening the session drives the Host's ordinary Agent resolution; the
    // job owner must be that exact live instance, never a second one.
    // `expect.poll` is test-scoped, so this hook polls by hand.
    agent = await liveAgent(scaffold, SessionId(SEED_ID))
  }, 120_000)

  afterAll(async () => {
    if (scaffold !== undefined) await writeFile(join(scaffold.workspaceCwd, RELEASE), '')
    await browser?.close()
    await scaffold?.close()
  })

  it('shows a running background job in the header without a refresh, then kills it from the two-press stop control', async () => {
    let phase = 'running'
    onTestFailed(() => saveFailureShot(page, `web-e2e-background-job-${phase}`))
    // Polling for zero would pass at t=0 before delivery and prove nothing.
    const trigger = page.getByRole('button', { name: '1 background job running' })
    expect(await trigger.count()).toBe(0)

    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('background-job-list-e2e'),
      name: 'bash',
      arguments: { command: COMMAND, description: 'Hold a background slot open', run_in_background: true },
      agent,
    })
    const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
    const matched = /\bbash-\d+\b/.exec(reported)
    if (matched === null) throw new Error(`background bash reported no job id: ${reported}`)
    const jobId = JobId(matched[0])

    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    const row = page.getByRole('list', { name: 'Background jobs' }).getByRole('listitem').first()
    await row.waitFor({ timeout: 10_000 })
    await expect.poll(() => row.textContent()).toContain(COMMAND)

    const running = await captureStableAria(page, '[aria-label="Background jobs"]', scaffold.workspaceCwd, { runningJobs: 'keep' })
    await compareOrRefreshGolden(RUNNING_EXPECTED, running, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])

    phase = 'settled'
    // The whole human path: arm, confirm, job.kill, registry kill, jobs
    // frames flipping the row — no registry call from the test.
    const stop = page.locator('[data-kill-state]')
    await stop.waitFor({ timeout: 10_000 })
    await stop.click()
    await expect.poll(() => stop.getAttribute('data-kill-state')).toBe('armed')
    await stop.click()

    // Exact: the running trigger's name ('1 background job running') contains this label.
    const idle = page.getByRole('button', { name: '1 background job', exact: true })
    await idle.waitFor({ timeout: 20_000 })
    // The unclaimed report's reason lands in the settled row's detail.
    await expect.poll(
      () => page.getByRole('list', { name: 'Background jobs' }).textContent(),
      { timeout: 15_000 },
    ).toContain('cancelled by the user')
    expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('killed')

    const settled = await captureStableAria(page, '[aria-label="Background jobs"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, settled, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)

  it('keeps the open list above the expanded right sidebar and in the header Tab order', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-right-sidebar'))
    const trigger = page.getByRole('button', { name: '1 background job', exact: true })
    if (await trigger.getAttribute('aria-expanded') === 'true') await trigger.click()
    await page.getByRole('button', { name: 'Open right sidebar' }).click()
    const sidebar = page.locator('[data-rightbar-col]')
    // A toggle holds data-animating on the frame until its tracks settle.
    await expect.poll(() => sidebar.evaluate(column => column.parentElement?.hasAttribute('data-animating'))).toBe(false)
    await trigger.click()
    const list = page.getByRole('list', { name: 'Background jobs' })
    await list.waitFor({ timeout: 10_000 })
    // The list crosses into the sidebar column, so the hit test below covers it.
    const [menuBox, sidebarBox] = await Promise.all([list.boundingBox(), sidebar.boundingBox()])
    if (menuBox === null || sidebarBox === null) throw new Error('job list geometry is unavailable')
    expect(menuBox.x + menuBox.width).toBeGreaterThan(sidebarBox.x)
    // Every corner of the list hit-tests to the list itself; the inset clears its rounded corners.
    const covered = await list.evaluate((menu) => {
      const rect = menu.getBoundingClientRect()
      const inset = 20
      const points: Array<[number, number]> = [
        [rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset],
        [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset],
      ]
      return points.filter(([x, y]) => !menu.contains(document.elementFromPoint(x, y)))
    })
    expect(covered).toEqual([])

    // Keyboard order matches the in-place list: the trigger leads into the
    // list, and Tab off its last control reaches the control after the trigger.
    const after = await trigger.evaluate((node) => {
      const all = [...document.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
      const outside = all.filter(el => el.closest('[aria-label="Background jobs"]') === null && el.tabIndex >= 0)
      return outside[outside.indexOf(node as HTMLElement) + 1]?.outerHTML.slice(0, 120)
    })
    expect(after).toMatch(/^<button/)
    await trigger.focus()
    await page.keyboard.press('Tab')
    expect(await list.evaluate(menu => menu.contains(document.activeElement))).toBe(true)
    const controls = await list.evaluate(menu => menu.querySelectorAll('button:not(:disabled)').length)
    for (let i = 1; i < controls; i += 1) await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))).toBe(after)
    await trigger.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await list.waitFor({ state: 'detached', timeout: 10_000 })
    expect(await trigger.evaluate(node => node === document.activeElement)).toBe(true)
  }, 60_000)

  it('opens a producer-confirmed target Session independently of output and retains navigation after settlement', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-target-session'))
    const sourceRow = page.locator(`[data-row-key="session:${SEED_ID}"]`)
    await sourceRow.click()
    // The bash scenario owns its goldens; hide its settled row before this producer starts.
    const oldList = page.getByRole('list', { name: 'Background jobs' })
    const oldTrigger = page.getByRole('button', { name: '1 background job', exact: true })
    if (await oldTrigger.count() > 0) {
      if (await oldList.count() === 0) await oldTrigger.click()
      await oldList.getByRole('button', { name: 'Clear', exact: true }).click()
    }

    const targetId = SessionId('background-job-list-target-web-e2e')
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), targetId)
    const target = await scaffold.ctx.sessionController.create({ sessionId: targetId, cwd: scaffold.workspaceCwd })
    await scaffold.ctx.sessionController.rename({ sessionId: target.sessionId, title: 'Confirmed job target' })
    const targetRow = page.locator(`[data-row-key="session:${target.sessionId}"]`)

    let producer!: JobHandle
    let finish!: (outcome: JobOutcome) => void
    const done = new Promise<JobOutcome>((resolve) => { finish = resolve })
    const jobId = scaffold.ctx.jobs.start({
      kind: 'bash', label: 'Inspect target workspace', description: 'Repository inspection in the target Session',
      owner: agent.id,
      run: (job) => {
        producer = job
        return { done, cancel: () => { finish({ status: 'killed' }) } }
      },
    })
    const list = page.getByRole('list', { name: 'Background jobs' })
    const navigation = list.getByRole('button', { name: 'Open target session', exact: true })
    try {
      await page.getByRole('button', { name: '1 background job running', exact: true }).click()
      await list.getByText('Repository inspection in the target Session', { exact: true }).waitFor()
      expect(await navigation.count()).toBe(0)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'association-pending.expected.md'),
        await captureStableAria(page, '[aria-label="Background jobs"]', scaffold.workspaceCwd, { runningJobs: 'keep' }), MODE)

      producer.setSession(target.sessionId)
      await navigation.waitFor({ timeout: 15_000 })
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'association-confirmed.expected.md'),
        await captureStableAria(page, '[aria-label="Background jobs"]', scaffold.workspaceCwd, { runningJobs: 'keep' }), MODE)
      await navigation.click()
      await expect.poll(() => targetRow.getAttribute('aria-selected')).toBe('true')
      expect(await list.count()).toBe(0)
      expect(scaffold.ctx.jobs.get(jobId, agent.id).status).toBe('running')
      expect(await page.getByRole('button', { name: /background job/ }).count()).toBe(0)

      await sourceRow.click()
      await expect.poll(() => sourceRow.getAttribute('aria-selected')).toBe('true')
      await page.getByRole('button', { name: '1 background job running', exact: true }).click()
      const clearSettled = list.getByRole('button', { name: 'Clear', exact: true })
      if (await clearSettled.count() > 0) await clearSettled.click()
      const outputToggle = list.getByRole('button', { name: 'Show live output of Inspect target workspace', exact: true })
      await outputToggle.waitFor()
      expect(await outputToggle.getAttribute('aria-expanded')).toBe('false')
      finish({ status: 'completed', detail: 'Inspection complete' })
      await page.getByRole('button', { name: '1 background job', exact: true }).waitFor({ timeout: 15_000 })
      await list.getByText('Inspection complete', { exact: true }).waitFor()
      expect(await outputToggle.count()).toBe(0)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'association-settled.expected.md'),
        await captureStableAria(page, '[aria-label="Background jobs"]', scaffold.workspaceCwd), MODE)
      await navigation.click()
      await expect.poll(() => targetRow.getAttribute('aria-selected')).toBe('true')
      await sourceRow.click()
      await expect.poll(() => sourceRow.getAttribute('aria-selected')).toBe('true')
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } finally {
      finish({ status: 'completed' })
      await done
      await expect.poll(() => scaffold.ctx.jobs.get(jobId, agent.id).status).not.toBe('running')
    }
  }, 90_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'running.expected.md', 'settled.expected.md', 'association-pending.expected.md',
      'association-confirmed.expected.md', 'association-settled.expected.md',
    ])
  })
})
