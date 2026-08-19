import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPidAlive, readPid } from '../src/daemon.ts'
import { startWeb, stopWeb, webStateFiles } from '../src/web.ts'

/** Registered temp dirs, removed (and live fake processes killed) after each test. */
const tempDirs: string[] = []

/** Create one named temp workspace under the OS tmp dir. */
function tmp(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-web-${label}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    for (const name of ['web.pid']) {
      const pidFile = join(dir, name)
      if (existsSync(pidFile)) {
        const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
        if (Number.isInteger(pid) && isPidAlive(pid)) {
          try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
        }
      }
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * A fake web launcher executable, mirroring how the real relaunch works: a CLI
 * binary that receives the profile invocation and a forwarded script entry.
 * It writes its received argv (the relaunched CLI's args, script entry first)
 * to `argvFile`, prints a boot marker to stderr (captured into the log by the
 * detached start), and stays alive until signalled. The fake is a standalone
 * executable (shebang, not `spawn(node, [script])`): vitest's fork-pool hook
 * hijacks node-launched JS children, and the electron suite already proves
 * the all-binary shape is vitest-safe. With `ignoreTerm` the fake traps
 * SIGTERM, so `stop` must escalate to SIGKILL.
 */
function fakeLauncher(label: string, ignoreTerm = false, printUrl = true, exitImmediately = false): {
  dir: string
  baseDir: string
  launcher: { execPath: string; script: string; loaderArgs: readonly string[] }
  argvFile: string
  pidFile: string
  logFile: string
} {
  const dir = tmp(label)
  const binary = join(dir, 'fake-web')
  const argvFile = join(dir, 'argv.json')
  const termTrap = ignoreTerm ? "process.on('SIGTERM', () => {})" : ''
  const urlLine = printUrl ? 'process.stderr.write("dsh web: http://127.0.0.1:59278\\n")' : ''
  const exitTail = exitImmediately
    ? 'process.stderr.write("dsh: plugin tree failed to load: listen EADDRINUSE: address already in use 127.0.0.1:3080\\n")\nprocess.exit(1)'
    : 'setInterval(() => {}, 1000)'
  writeFileSync(binary, [
    '#!/usr/bin/env node',
    '"use strict"',
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)))`,
    'process.stderr.write("fake-web-booted\\n")',
    urlLine,
    termTrap,
    exitTail,
    '',
  ].join('\n'))
  chmodSync(binary, 0o755)
  const state = webStateFiles({ baseDir: dir })
  return {
    dir,
    baseDir: dir,
    // `startWeb` spawns `execPath` with `script` as its first argument; the
    // fake records them both in its argv. No loader switches in tests.
    launcher: { execPath: binary, script: 'fake-entry.js', loaderArgs: [] },
    argvFile,
    pidFile: state.pidFile,
    logFile: state.logFile,
  }
}

/** Poll until the fake web wrote its argv (or fail after ~3s). */
async function waitForArgv(argvFile: string, logFile?: string): Promise<string[]> {
  const deadline = Date.now() + 3000
  while (!existsSync(argvFile)) {
    if (Date.now() > deadline) {
      const marker = logFile !== undefined && existsSync(logFile)
        ? `\nlog:\n${readFileSync(logFile, 'utf8')}`
        : ''
      throw new Error(`fake web never wrote its argv${marker}`)
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]
}

/** Poll until the pid is no longer alive (or fail after ~4s). */
async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 4000
  while (isPidAlive(pid)) {
    if (Date.now() > deadline) throw new Error(`pid ${pid} still alive`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Capture writes to `stdout`/`stderr` until {@link restore} runs. */
function capture(streamName: 'stdout' | 'stderr'): { restore: () => void; text: () => string } {
  const stream = streamName === 'stdout' ? process.stdout : process.stderr
  const original = stream.write.bind(stream)
  const parts: string[] = []
  stream.write = (chunk: string | Uint8Array) => { parts.push(String(chunk)); return true }
  return {
    restore: () => { stream.write = original },
    text: () => parts.join(''),
  }
}

describe('webStateFiles', () => {
  it('places web pid and log under the selected base directory', () => {
    const baseDir = tmp('state')
    expect(webStateFiles({ baseDir }))
      .toEqual({ pidFile: join(baseDir, 'web.pid'), logFile: join(baseDir, 'web.log') })
  })
})

describe('startWeb', () => {
  it('spawns the CLI relaunch detached, records the pid, and prints the readiness URL once available', async () => {
    const fake = fakeLauncher('start')
    const stdout = capture('stdout')
    const code = await startWeb(['--port', '8080'], { launcher: fake.launcher, baseDir: fake.baseDir, patchFiles: ['extra.yml'] })
    stdout.restore()
    expect(code).toBe(0)
    const pid = readPid(fake.pidFile)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    expect(isPidAlive(pid)).toBe(true)
    expect(await waitForArgv(fake.argvFile, fake.logFile)).toEqual([
      'fake-entry.js',
      '--profile', 'web',
      '--patch', 'extra.yml',
      '--port', '8080',
    ])
    expect(readFileSync(fake.logFile, 'utf8')).toContain('fake-web-booted')
    expect(stdout.text()).toContain('dsh web: http://127.0.0.1:59278')
  })

  it('reports the log instead when the URL line stays silent', async () => {
    const fake = fakeLauncher('silent', false, false)
    const stdout = capture('stdout')
    const code = await startWeb([], { launcher: fake.launcher, baseDir: fake.baseDir, urlTimeoutMs: 50 })
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('URL line not ready')
    expect(stdout.text()).toContain('see the log')
  })

  it('fails loud with the child summary when the server exits before becoming ready', async () => {
    const fake = fakeLauncher('crashed', false, false, true)
    const stderr = capture('stderr')
    const code = await startWeb([], { launcher: fake.launcher, baseDir: fake.baseDir, urlTimeoutMs: 5000 })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('exited before becoming ready')
    expect(stderr.text()).toContain('EADDRINUSE')
    expect(stderr.text()).toContain('see the log')
    // The dead pid must not poison the next launch.
    expect(existsSync(fake.pidFile)).toBe(false)
  })

  it('fails loud when an instance is already running and still shows its URL', async () => {
    const fake = fakeLauncher('dup')
    await startWeb([], { launcher: fake.launcher, baseDir: fake.baseDir })
    const stderr = capture('stderr')
    const stdout = capture('stdout')
    const again = await startWeb([], { launcher: fake.launcher, baseDir: fake.baseDir })
    stderr.restore()
    stdout.restore()
    expect(again).toBe(1)
    expect(stderr.text()).toContain('already running')
    expect(stderr.text()).toContain('dsh web stop')
    expect(stdout.text()).toContain('dsh web: http://127.0.0.1:59278')
  })
})

describe('stopWeb', () => {
  it('stops a started server and removes the pid file', async () => {
    const fake = fakeLauncher('stop')
    await startWeb([], { launcher: fake.launcher, baseDir: fake.baseDir })
    await waitForArgv(fake.argvFile, fake.logFile) // the fake must boot (and register signal handlers) before stop signals
    const pid = readPid(fake.pidFile)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    const code = await stopWeb({ baseDir: fake.baseDir })
    expect(code).toBe(0)
    expect(existsSync(fake.pidFile)).toBe(false)
    await waitForExit(pid)
  })

  it('escalates to SIGKILL when the server ignores SIGTERM', async () => {
    const fake = fakeLauncher('stubborn', true)
    await startWeb([], { launcher: fake.launcher, baseDir: fake.baseDir })
    await waitForArgv(fake.argvFile, fake.logFile) // ensure the SIGTERM trap is installed before we signal
    const pid = readPid(fake.pidFile)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    const stdout = capture('stdout')
    const code = await stopWeb({ baseDir: fake.baseDir, killTimeoutMs: 100 })
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('SIGKILL')
    expect(existsSync(fake.pidFile)).toBe(false)
    await waitForExit(pid)
  })

  it('fails loud when nothing was started', async () => {
    const stderr = capture('stderr')
    const code = await stopWeb({ baseDir: tmp('stop-missing') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('nothing to stop')
  })

  it('removes a stale pid file when the process is already gone', async () => {
    const baseDir = tmp('stale')
    writeFileSync(join(baseDir, 'web.pid'), '2147483647\n') // implausibly high pid
    const code = await stopWeb({ baseDir })
    expect(code).toBe(0)
    expect(existsSync(join(baseDir, 'web.pid'))).toBe(false)
  })
})
