/**
 * `dsh electron` — control the desktop app over the same web profile `dsh web`
 * boots. `start` spawns the in-repo `@deepseek-ai/dsh-electron` package's
 * own `electron` binary detached, with its output appended to
 * `$DSH_HOME/electron.log` and its pid recorded in `$DSH_HOME/electron.pid`;
 * `stop` reads the pid, escalates SIGTERM to SIGKILL after a grace period, and
 * removes the pid file; `log` tails the log file. The app's own main process
 * boots the shared `web` profile inside the Electron renderer, so the browser
 * and the desktop surfaces share every requested plugin tree; nothing about
 * the harness tree lives in this process.
 * @module @deepseek-ai/dsh/electron-launch
 */

import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  daemonStateFiles,
  isPidAlive as isProcessAlive,
  readPid,
  stopDaemon,
  type StopDaemonOptions,
} from './daemon.ts'

const NAME = 'dsh'

/**
 * The desktop app package lives beside the CLI in the repository layout:
 * `../../electron` from `src/` (source launch) and from `lib/` (bundled bin)
 * both resolve to `apps/electron`.
 * @returns the absolute desktop-app directory.
 */
export function resolveAppDir(): string {
  return fileURLToPath(new URL('../../electron/', import.meta.url))
}

/**
 * Resolve the electron executable the desktop app's own devDependencies pull
 * in. The `electron` npm package ships a `path.txt` naming its binary under
 * `dist/`. The lookup walks `node_modules` upward from the app directory —
 * the same chain Node would use — but deliberately stops at `NODE_PATH` and
 * module-registry globals, so a bare directory can never resolve an electron
 * installed somewhere unrelated. A pnpm store layout (a symlinked
 * `apps/electron/node_modules/electron`) and a hoisted node_modules both hit.
 * @param appDir - the desktop-app directory whose dependency tree loads `electron`.
 * @returns the absolute electron executable path, or `undefined` when the
 * package or its binary is missing.
 */
export function resolveElectronBinary(appDir: string): string | undefined {
  const packageDir = findElectronPackageDir(appDir)
  if (packageDir === undefined) return undefined
  const pathFile = join(packageDir, 'path.txt')
  if (!existsSync(pathFile)) return undefined
  const relative = readFileSync(pathFile, 'utf8').trim()
  if (relative === '') return undefined
  const binary = join(packageDir, 'dist', relative)
  return existsSync(binary) ? binary : undefined
}

/**
 * Walk `node_modules` directories upward from {@link startDir} and return the
 * first `electron` package directory, or `undefined` when none exists.
 * @param startDir - the directory whose resolution chain the search begins at.
 */
function findElectronPackageDir(startDir: string): string | undefined {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, 'node_modules', 'electron', 'package.json')
    if (existsSync(candidate)) return dirname(candidate)
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Options for the electron control actions, injectable by tests. */
export interface ElectronControlOptions {
  /** The desktop-app directory; defaults to {@link resolveAppDir}. */
  appDir?: string
  /** The electron executable; defaults to {@link resolveElectronBinary}. */
  binary?: string
  /** Where the pid and log files live; defaults to the resolved `$DSH_HOME`. */
  baseDir?: string
  /** How long `stop` waits for a graceful SIGTERM exit before SIGKILL. */
  killTimeoutMs?: number
}

/** The pid-file/log-file pair for a state directory. */
export interface ElectronStateFiles {
  /** Absolute pid-file path. */
  pidFile: string
  /** Absolute log-file path. */
  logFile: string
}

/**
 * Resolve the state files for the electron control actions.
 * @param options - control options (the base directory).
 * @returns the pid and log file paths.
 */
export function electronStateFiles(options: ElectronControlOptions = {}): ElectronStateFiles {
  return daemonStateFiles(options.baseDir ?? resolveDshHome(), 'electron')
}

/**
 * Read the pid the last `start` recorded.
 * @param options - control options (the base directory).
 * @returns the recorded pid, or `undefined` when the pid file is absent or corrupt.
 */
export function readElectronPid(options: ElectronControlOptions = {}): number | undefined {
  return readPid(electronStateFiles(options).pidFile)
}

/**
 * Test whether another process is live with the given pid.
 * @param pid - the process id to probe.
 * @returns `true` when the process is alive (signal reachable), else `false`.
 */
export function isPidAlive(pid: number): boolean {
  return isProcessAlive(pid)
}

/**
 * Start the desktop app detached: write its pid, redirect output to the log,
 * and return immediately. A live previous instance fails loud instead of
 * stacking a second.
 * @param args - the forwarded Electron main-process arguments (after any `start` keyword).
 * @param options - control options (app dir, binary, base directory).
 * @returns 0 on launch, 1 on any failure.
 */
export async function startElectron(args: readonly string[], options: ElectronControlOptions = {}): Promise<number> {
  const appDir = options.appDir ?? resolveAppDir()
  const manifestPath = join(appDir, 'package.json')
  if (!existsSync(manifestPath)) {
    process.stderr.write(`${NAME}: desktop app not found at ${appDir} — this command launches the in-repo @deepseek-ai/dsh-electron package\n`)
    return 1
  }
  const binary = options.binary ?? resolveElectronBinary(appDir)
  if (binary === undefined) {
    process.stderr.write(
      `${NAME}: electron binary is not installed for ${appDir} — run 'pnpm install' (or 'pnpm --filter @deepseek-ai/dsh-electron install') first\n`,
    )
    return 1
  }
  const { pidFile, logFile } = electronStateFiles(options)
  const running = readElectronPid(options)
  if (running !== undefined && isPidAlive(running)) {
    process.stderr.write(`${NAME}: electron is already running (pid ${running}, pid file ${pidFile}); run 'dsh electron stop' first\n`)
    return 1
  }
  // `start` inherits nothing from the shell: stdin drops, stdout/stderr append
  // to the log so the launching terminal can close freely.
  let logFd: number
  try {
    logFd = openSync(logFile, 'a')
  } catch (error) {
    process.stderr.write(`${NAME}: cannot open log ${logFile}: ${(error as Error).message}\n`)
    return 1
  }
  const child = spawn(binary, [appDir, ...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  try {
    // Electron's first non-option argument is the app path (like `electron .`).
    writeFileSync(pidFile, `${child.pid}\n`)
  } catch (error) {
    process.stderr.write(`${NAME}: cannot write pid file ${pidFile}: ${(error as Error).message}\n`)
    if (child.pid !== undefined && isPidAlive(child.pid)) child.kill('SIGKILL')
    return 1
  }
  child.unref()
  process.stdout.write(`${NAME}: electron started (pid ${child.pid}); log: ${logFile}\n`)
  return 0
}

/**
 * Stop the running desktop app: SIGTERM, escalate to SIGKILL after
 * {@link ElectronControlOptions.killTimeoutMs}, remove the pid file.
 * @param options - control options (base directory, kill timeout).
 * @returns 0 when stopped, 1 when nothing was recorded or the process survives SIGKILL.
 */
export async function stopElectron(options: ElectronControlOptions = {}): Promise<number> {
  const { pidFile } = electronStateFiles(options)
  const opts: StopDaemonOptions = { pidFile, name: 'electron' }
  if (options.killTimeoutMs !== undefined) opts.killTimeoutMs = options.killTimeoutMs
  return await stopDaemon(opts)
}

/**
 * Follow the electron log with `tail -f` (a POSIX tool; on systems without it,
 * the spawn error is reported instead of a silent no-op).
 * @param lines - how many trailing lines to show first.
 * @param options - control options (base directory).
 * @returns a promise that settles when `tail` exits (the user pressed
 * Ctrl+C, which only stops the tail, never the desktop app).
 */
export async function tailElectronLog(lines: number, options: ElectronControlOptions = {}): Promise<number> {
  const { logFile } = electronStateFiles(options)
  if (!existsSync(logFile)) {
    process.stderr.write(`${NAME}: electron log not found at ${logFile} — start the app first with 'dsh electron' (or 'dsh electron start')\n`)
    return 1
  }
  return await new Promise<number>((resolve) => {
    const tail = spawn('tail', ['-n', String(lines), '-f', logFile], { stdio: 'inherit' })
    tail.on('error', (error) => {
      process.stderr.write(`${NAME}: cannot run tail: ${error.message} (this surface needs POSIX tail)\n`)
      resolve(1)
    })
    tail.on('exit', (code) => { resolve(code ?? 0) })
  })
}
