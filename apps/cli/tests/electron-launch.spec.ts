import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveElectronBinary, runElectron } from '../src/electron-launch.ts'

/** Registered temp dirs, removed after each test. */
const tempDirs: string[] = []

/** Create one named temp workspace under the OS tmp dir. */
function tmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-electron-${name}-`))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Lay out an `electron` npm package plus a fake executable, mirroring what the
 * real installed package does: `path.txt` names a binary under `dist/`. The
 * fake binary writes its received argv (the app dir first, then the forwarded
 * args) to `<appDir>/argv.json` and exits with {@link exitCode}.
 * @param appDir - the app directory whose node_modules holds the fake package.
 * @param exitCode - exit code for the fake binary.
 * @returns the fake binary path (what {@link resolveElectronBinary} returns).
 */
function installFakeElectron(appDir: string, exitCode = 0): string {
  const packageDir = join(appDir, 'node_modules', 'electron')
  mkdirSync(join(packageDir, 'dist'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'electron', version: '43.4.0', main: 'index.js' }))
  // resolve('electron') must land on a real file for dirname() to be the package root.
  writeFileSync(join(packageDir, 'index.js'), 'module.exports = null\n')
  writeFileSync(join(packageDir, 'path.txt'), 'fake-electron')
  const binary = join(packageDir, 'dist', 'fake-electron')
  writeFileSync(binary, [
    '#!/usr/bin/env node',
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(join(appDir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)))`,
    `process.exit(${exitCode})`,
    '',
  ].join('\n'))
  chmodSync(binary, 0o755)
  return binary
}

/** An empty app dir with just a package.json, for failure-path tests. */
function bareApp(name: string): string {
  const dir = tmp(name)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fake-desktop-app' }))
  return dir
}

/** Capture writes to stderr until {@link restore} runs; {@link text} joins them. */
function captureStderr(): { restore: () => void; text: string } {
  const original = process.stderr.write
  const parts: string[] = []
  process.stderr.write = ((chunk: string | Uint8Array) => { parts.push(String(chunk)); return true }) as typeof original
  return {
    restore: () => { process.stderr.write = original },
    get text() { return parts.join('') },
  }
}

describe('resolveElectronBinary', () => {
  it('resolves the binary named by the electron package path.txt', () => {
    const appDir = bareApp('resolve')
    mkdirSync(join(appDir, 'node_modules', 'electron', 'dist'), { recursive: true })
    writeFileSync(join(appDir, 'node_modules', 'electron', 'package.json'), JSON.stringify({
      name: 'electron',
      version: '43.4.0',
      main: 'index.js',
    }))
    writeFileSync(join(appDir, 'node_modules', 'electron', 'index.js'), 'module.exports = null\n')
    writeFileSync(join(appDir, 'node_modules', 'electron', 'path.txt'), 'fake-electron')
    mkdirSync(join(appDir, 'node_modules', 'electron', 'dist'), { recursive: true })
    writeFileSync(join(appDir, 'node_modules', 'electron', 'dist', 'fake-electron'), '#!/bin/sh\n')
    chmodSync(join(appDir, 'node_modules', 'electron', 'dist', 'fake-electron'), 0o755)
    expect(resolveElectronBinary(appDir))
      .toBe(join(appDir, 'node_modules', 'electron', 'dist', 'fake-electron'))
  })

  it('returns undefined when electron is not installed', () => {
    expect(resolveElectronBinary(bareApp('missing'))).toBeUndefined()
  })
})

describe('runElectron', () => {
  it('spawns the desktop app with the app directory first and returns its exit code', async () => {
    const appDir = bareApp('spawn')
    const binary = installFakeElectron(appDir, 0)
    expect(await runElectron(['--dev'], { appDir, binary })).toBe(0)
    const argv = JSON.parse(readFileSync(join(appDir, 'argv.json'), 'utf8')) as string[]
    expect(argv).toEqual([appDir, '--dev'])
  })

  it('propagates a non-zero child exit code', async () => {
    const appDir = bareApp('nonzero')
    const binary = installFakeElectron(appDir, 7)
    expect(await runElectron([], { appDir, binary })).toBe(7)
  })

  it('fails loud when the desktop app package is missing', async () => {
    const dir = tmp('no-app')
    const stderr = captureStderr()
    const code = await runElectron([], { appDir: dir })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text).toContain('desktop app not found')
    expect(stderr.text).toContain(dir)
  })

  it('fails loud when the electron binary is not installed', async () => {
    const stderr = captureStderr()
    const code = await runElectron([], { appDir: bareApp('no-electron') })
    stderr.restore()
    expect(code).toBe(1)
    expect(stderr.text).toContain('electron binary is not installed')
    expect(stderr.text).toContain('pnpm install')
  })
})
