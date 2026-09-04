import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RESTART_SUPERVISOR_ENV,
  electronStateFiles,
  isPidAlive,
  readElectronPid,
  resolveElectronBinary,
  restartElectron,
  startElectron,
  stopElectron,
  tailElectronLog,
} from '../src/electron.ts'

/** Registered temp dirs, removed (and live fake processes killed) after each test. */
const tempDirs: string[] = []

/** Create one named temp workspace under the OS tmp dir. */
function tmp(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-electron-${label}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  // oxlint no-dynamic-delete requires a static key; keep in sync with RESTART_SUPERVISOR_ENV.
  delete process.env.DSH_ELECTRON_RESTART_SUPERVISOR
  for (const dir of tempDirs.splice(0)) {
    const pidFile = join(dir, 'electron.pid')
    if (existsSync(pidFile)) {
      const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
      if (Number.isInteger(pid) && isPidAlive(pid)) {
        try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
      }
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

/** An app dir holding just a package.json — no electron installed. */
function bareAppDir(label: string): string {
  const dir = tmp(label)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-desktop-app' }))
  return dir
}

/** A complete fake desktop app: app dir (electron installed) + state dir. */
interface FakeDesktop {
  appDir: string
  baseDir: string
  binary: string
  pidFile: string
  logFile: string
  argvFile: string
  readyFile: string
}

/**
 * Lay out an `electron` npm package plus a fake executable, mirroring the real
 * installed package: `path.txt` names a binary under `dist/`. The fake binary
 * writes its received argv (app dir first, then forwarded args) to
 * `<appDir>/argv.json`, prints a boot marker to stderr (captured into the log
 * by the detached start), writes `<appDir>/ready` only after the SIGTERM trap
 * is installed, and stays alive until signalled. With `ignoreTerm` the fake
 * traps SIGTERM, so `stop` must escalate to SIGKILL.
 */
function fakeDesktop(label: string, ignoreTerm = false): FakeDesktop {
  const appDir = bareAppDir(label)
  const packageDir = join(appDir, 'node_modules', 'electron')
  mkdirSync(join(packageDir, 'dist'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'electron', version: '43.4.0', main: 'index.js' }))
  writeFileSync(join(packageDir, 'index.js'), 'module.exports = null\n')
  writeFileSync(join(packageDir, 'path.txt'), 'fake-electron')
  const binary = join(packageDir, 'dist', 'fake-electron')
  const argvFile = join(appDir, 'argv.json')
  const readyFile = join(appDir, 'ready')
  const termTrap = ignoreTerm ? "process.on('SIGTERM', () => {})" : ''
  writeFileSync(binary, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)))`,
    'process.stderr.write("fake-electron-booted\\n")',
    termTrap,
    `fs.writeFileSync(${JSON.stringify(readyFile)}, "ready\\n")`,
    'setInterval(() => {}, 1000)',
    '',
  ].join('\n'))
  chmodSync(binary, 0o755)
  const baseDir = tmp(`${label}-state`)
  const state = electronStateFiles({ baseDir })
  return { appDir, baseDir, binary, pidFile: state.pidFile, logFile: state.logFile, argvFile, readyFile }
}

/** Poll until the fake electron wrote its argv (or fail after ~3s). */
async function waitForArgv(fake: FakeDesktop): Promise<string[]> {
  const deadline = Date.now() + 3000
  while (!existsSync(fake.argvFile)) {
    if (Date.now() > deadline) throw new Error('fake electron never wrote its argv')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return JSON.parse(readFileSync(fake.argvFile, 'utf8')) as string[]
}

/** Poll until the pid is no longer alive (or fail after ~4s). */
async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 4000
  while (isPidAlive(pid)) {
    if (Date.now() > deadline) throw new Error(`pid ${pid} still alive`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Poll until the fake electron's recorded argv equals the expected value. */
async function waitForArgvToEqual(fake: FakeDesktop, expected: string[]): Promise<void> {
  const deadline = Date.now() + 3000
  const wanted = JSON.stringify(expected)
  while (true) {
    if (existsSync(fake.argvFile)
      && JSON.stringify(JSON.parse(readFileSync(fake.argvFile, 'utf8')) as string[]) === wanted) return
    if (Date.now() > deadline) throw new Error(`fake electron argv never became ${wanted}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Poll until the fake electron is fully booted: SIGTERM trap installed, boot marker written. */
async function waitForReady(fake: FakeDesktop): Promise<void> {
  const deadline = Date.now() + 3000
  while (!existsSync(fake.readyFile)) {
    if (Date.now() > deadline) throw new Error('fake electron never became ready')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Poll until the log carries at least `count` boot markers (or fail after ~3s). */
async function waitForLogMarkers(fake: FakeDesktop, count: number): Promise<void> {
  const deadline = Date.now() + 3000
  while (true) {
    const markers = readFileSync(fake.logFile, 'utf8').match(/fake-electron-booted/g)
    if (markers !== null && markers.length >= count) return
    if (Date.now() > deadline) throw new Error(`log never carried ${count} boot markers`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/**
 * A fake restart supervisor executable, mirroring how the real one is
 * relaunched: a CLI binary that records its received argv (the relaunched
 * CLI's args, script entry first) and the supervisor marker env, prints a
 * boot marker to stderr (captured into the log by the detached dispatch),
 * and exits.
 */
function fakeSupervisorLauncher(label: string): {
  launcher: { execPath: string; script: string; loaderArgs: readonly string[] }
  recordFile: string
} {
  const dir = tmp(`restart-supervisor-${label}`)
  const binary = join(dir, 'fake-restart-supervisor')
  const recordFile = join(dir, 'record.json')
  writeFileSync(binary, [
    '#!/usr/bin/env node',
    '"use strict"',
    'const fs = require("node:fs")',
    'process.stderr.write("restart-supervisor-booted\\n")',
    `fs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ argv: process.argv.slice(2), supervisor: process.env[${JSON.stringify(RESTART_SUPERVISOR_ENV)}] ?? null }))`,
    '',
  ].join('\n'))
  chmodSync(binary, 0o755)
  return { launcher: { execPath: binary, script: 'fake-entry.js', loaderArgs: [] }, recordFile }
}

/** Poll until the fake restart supervisor recorded its invocation (or fail after ~3s). */
async function waitForSupervisorRecord(recordFile: string): Promise<{ argv: string[]; supervisor: string | null }> {
  const deadline = Date.now() + 3000
  while (!existsSync(recordFile)) {
    if (Date.now() > deadline) throw new Error('fake restart supervisor never recorded its invocation')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return JSON.parse(readFileSync(recordFile, 'utf8')) as { argv: string[]; supervisor: string | null }
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

describe('resolveElectronBinary', () => {
  it('resolves the binary named by the electron package path.txt', () => {
    const fake = fakeDesktop('resolve')
    expect(resolveElectronBinary(fake.appDir)).toBe(fake.binary)
  })

  it('returns undefined when electron is not installed', () => {
    expect(resolveElectronBinary(bareAppDir('resolve-missing'))).toBeUndefined()
  })
})

describe('electronStateFiles and readElectronPid', () => {
  it('places pid and log under the selected base directory', () => {
    const baseDir = tmp('state')
    expect(electronStateFiles({ baseDir }))
      .toEqual({ pidFile: join(baseDir, 'electron.pid'), logFile: join(baseDir, 'electron.log') })
  })

  it('reads a recorded pid and treats corrupt or absent files as undefined', () => {
    const baseDir = tmp('pid')
    writeFileSync(join(baseDir, 'electron.pid'), '4242\n')
    expect(readElectronPid({ baseDir })).toBe(4242)
    expect(readElectronPid({ baseDir: tmp('pid-fallback') })).toBeUndefined()
    writeFileSync(join(baseDir, 'electron.pid'), 'not a number')
    expect(readElectronPid({ baseDir })).toBeUndefined()
  })
})

describe('startElectron', () => {
  it('spawns detached with the app dir first, records the pid, and opens the log', async () => {
    const fake = fakeDesktop('start')
    const code = await startElectron(['--dev'], fake)
    expect(code).toBe(0)
    const pid = readElectronPid(fake)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    expect(isPidAlive(pid)).toBe(true)
    expect(await waitForArgv(fake)).toEqual([fake.appDir, '--dev'])
    expect(readFileSync(fake.logFile, 'utf8')).toContain('fake-electron-booted')
  })

  it('fails loud when the desktop app package is missing', async () => {
    const stderr = capture('stderr')
    const code = await startElectron([], { appDir: tmp('missing-app') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('desktop app not found')
  })

  it('fails loud when electron is not installed', async () => {
    const stderr = capture('stderr')
    const code = await startElectron([], { appDir: bareAppDir('missing-binary'), baseDir: tmp('bin-state') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('electron binary is not installed')
  })

  it('fails loud when an instance is already running', async () => {
    const fake = fakeDesktop('dup')
    await startElectron([], fake)
    const stderr = capture('stderr')
    const again = await startElectron([], fake)
    stderr.restore()
    expect(again).toBe(1)
    expect(stderr.text()).toContain('already running')
    expect(stderr.text()).toContain('dsh electron stop')
  })
})

describe('stopElectron', () => {
  it('stops a started app and removes the pid file', async () => {
    const fake = fakeDesktop('stop')
    await startElectron([], fake)
    await waitForArgv(fake) // the fake must boot (and register signal handlers) before stop signals
    const pid = readElectronPid(fake)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    const code = await stopElectron(fake)
    expect(code).toBe(0)
    expect(existsSync(fake.pidFile)).toBe(false)
    await waitForExit(pid)
  })

  it('escalates to SIGKILL when the app ignores SIGTERM', async () => {
    const fake = fakeDesktop('stubborn', true)
    await startElectron([], fake)
    await waitForReady(fake) // ensure the SIGTERM trap is installed before we signal
    const pid = readElectronPid(fake)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    const stdout = capture('stdout')
    const code = await stopElectron({ ...fake, killTimeoutMs: 100 })
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('SIGKILL')
    expect(existsSync(fake.pidFile)).toBe(false)
    await waitForExit(pid)
  })

  it('fails loud when nothing was started', async () => {
    const stderr = capture('stderr')
    const code = await stopElectron({ baseDir: tmp('stop-missing') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('nothing to stop')
  })

  it('removes a stale pid file when the process is already gone', async () => {
    const baseDir = tmp('stale')
    writeFileSync(join(baseDir, 'electron.pid'), '2147483647\n') // implausibly high pid
    const code = await stopElectron({ baseDir })
    expect(code).toBe(0)
    expect(existsSync(join(baseDir, 'electron.pid'))).toBe(false)
  })
})

describe('restartElectron', () => {
  /** Run a call under the supervisor marker, the exact condition the detached supervisor runs in. */
  async function asSupervisor<T>(run: () => Promise<T>): Promise<T> {
    process.env[RESTART_SUPERVISOR_ENV] = '1'
    try {
      return await run()
    } finally {
      // oxlint no-dynamic-delete requires a static key; keep in sync with RESTART_SUPERVISOR_ENV.
      delete process.env.DSH_ELECTRON_RESTART_SUPERVISOR
    }
  }

  it('dispatches a detached supervisor with the marker and the forwarded app args', async () => {
    const fake = fakeDesktop('restart-dispatch')
    const supervisor = fakeSupervisorLauncher('dispatch')
    const stdout = capture('stdout')
    const code = await restartElectron(['--dev'], {
      appDir: fake.appDir,
      baseDir: fake.baseDir,
      launcher: supervisor.launcher,
    })
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('restart dispatched')
    const record = await waitForSupervisorRecord(supervisor.recordFile)
    expect(record.argv).toEqual(['fake-entry.js', 'electron', 'restart', '--dev'])
    expect(record.supervisor).toBe('1')
    // The dispatcher records nothing itself; the supervisor's sequence owns the pid file.
    expect(existsSync(fake.pidFile)).toBe(false)
    expect(readFileSync(fake.logFile, 'utf8')).toContain('restart-supervisor-booted')
  })

  it('fails loud before dispatch when the desktop app package is missing', async () => {
    const stderr = capture('stderr')
    const code = await restartElectron([], { appDir: tmp('restart-missing-app') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('desktop app not found')
  })

  it('fails loud before dispatch when electron is not installed', async () => {
    const stderr = capture('stderr')
    const code = await restartElectron([], { appDir: bareAppDir('restart-missing-binary'), baseDir: tmp('restart-bin-state') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('electron binary is not installed')
  })

  it('kills the running instance, waits for its exit, and launches a fresh one', async () => {
    const fake = fakeDesktop('restart')
    await startElectron([], fake)
    await waitForReady(fake) // the fake must be fully booted (boot marker written) before stop signals
    const oldPid = readElectronPid(fake)
    expect(oldPid).toBeDefined()
    if (oldPid === undefined) return
    const stdout = capture('stdout')
    const code = await asSupervisor(() => restartElectron(['--dev'], fake))
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('stopping electron')
    expect(stdout.text()).toContain('electron started')
    const newPid = readElectronPid(fake)
    expect(newPid).toBeDefined()
    expect(newPid).not.toBe(oldPid)
    if (newPid === undefined) return
    expect(isPidAlive(newPid)).toBe(true)
    await waitForExit(oldPid)
    await waitForArgvToEqual(fake, [fake.appDir, '--dev'])
    await waitForLogMarkers(fake, 2)
    expect(readFileSync(fake.logFile, 'utf8').match(/fake-electron-booted/g)).toHaveLength(2)
  })

  it('starts fresh when nothing was recorded, without treating it as an error', async () => {
    const fake = fakeDesktop('restart-fresh')
    const stdout = capture('stdout')
    const code = await asSupervisor(() => restartElectron([], fake))
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('no electron pid file')
    expect(stdout.text()).toContain('electron started')
    const pid = readElectronPid(fake)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    expect(isPidAlive(pid)).toBe(true)
    expect(await waitForArgv(fake)).toEqual([fake.appDir])
  })

  it('cleans a stale pid file and starts', async () => {
    const fake = fakeDesktop('restart-stale')
    writeFileSync(fake.pidFile, '2147483647\n') // implausibly high pid
    const stdout = capture('stdout')
    const code = await asSupervisor(() => restartElectron([], fake))
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('stale pid')
    expect(stdout.text()).toContain('electron started')
    const pid = readElectronPid(fake)
    expect(pid).toBeDefined()
    if (pid === undefined) return
    expect(isPidAlive(pid)).toBe(true)
  })

  it('escalates to SIGKILL when the running instance ignores SIGTERM', async () => {
    const fake = fakeDesktop('restart-stubborn', true)
    await startElectron([], fake)
    await waitForReady(fake) // ensure the SIGTERM trap is installed before we signal
    const oldPid = readElectronPid(fake)
    expect(oldPid).toBeDefined()
    if (oldPid === undefined) return
    const stdout = capture('stdout')
    const code = await asSupervisor(() => restartElectron([], { ...fake, killTimeoutMs: 100 }))
    stdout.restore()
    expect(code).toBe(0)
    expect(stdout.text()).toContain('SIGKILL')
    const newPid = readElectronPid(fake)
    expect(newPid).toBeDefined()
    expect(newPid).not.toBe(oldPid)
    if (newPid === undefined) return
    expect(isPidAlive(newPid)).toBe(true)
    await waitForExit(oldPid)
  })
})

describe('tailElectronLog', () => {
  it('fails loud before the app has written a log', async () => {
    const stderr = capture('stderr')
    const code = await tailElectronLog(100, { baseDir: tmp('no-log') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('start the app first')
  })
})
