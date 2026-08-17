import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  electronStateFiles,
  isPidAlive,
  readElectronPid,
  resolveElectronBinary,
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
}

/**
 * Lay out an `electron` npm package plus a fake executable, mirroring the real
 * installed package: `path.txt` names a binary under `dist/`. The fake binary
 * writes its received argv (app dir first, then forwarded args) to
 * `<appDir>/argv.json`, prints a boot marker to stderr (captured into the log
 * by the detached start), and stays alive until signalled. With `ignoreTerm`
 * the fake traps SIGTERM, so `stop` must escalate to SIGKILL.
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
  const termTrap = ignoreTerm ? "process.on('SIGTERM', () => {})" : ''
  writeFileSync(binary, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)))`,
    'process.stderr.write("fake-electron-booted\\n")',
    termTrap,
    'setInterval(() => {}, 1000)',
    '',
  ].join('\n'))
  chmodSync(binary, 0o755)
  const baseDir = tmp(`${label}-state`)
  const state = electronStateFiles({ baseDir })
  return { appDir, baseDir, binary, pidFile: state.pidFile, logFile: state.logFile, argvFile }
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

/** Capture writes to `stdout`/`stderr` until {@link restore} runs. */
function capture(streamName: 'stdout' | 'stderr'): { restore: () => void; text: () => string } {
  const stream = streamName === 'stdout' ? process.stdout : process.stderr
  const original = stream.write
  const parts: string[] = []
  stream.write = ((chunk: string | Uint8Array) => { parts.push(String(chunk)); return true }) as typeof original
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
    await waitForArgv(fake) // ensure the SIGTERM trap is installed before we signal
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

describe('tailElectronLog', () => {
  it('fails loud before the app has written a log', async () => {
    const stderr = capture('stderr')
    const code = await tailElectronLog(100, { baseDir: tmp('no-log') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text()).toContain('start the app first')
  })
})
