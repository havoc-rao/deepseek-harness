/**
 * `dsh web` — pid-file control for the browser GUI. The bare command relaunches
 * *this same CLI* as `dsh --profile web <args>` detached: its pid lands in
 * `$DSH_HOME/web.pid`, its output appends to `$DSH_HOME/web.log`, and the
 * terminal stays usable once the pid file is written. `stop` reads the pid and
 * runs the shared SIGTERM-then-SIGKILL protocol; the profile's own signal
 * handling disposes the harness tree on SIGTERM, so a normal stop is graceful.
 *
 * The foreground path is a different command shape, not an option to this one:
 * `dsh web --dev` is parsed by the launcher (args.ts) as a plain profile boot,
 * so the URL line lands on the terminal and Ctrl+C disposes the tree in place.
 * @module @deepseek-ai/dsh/web
 */

import { spawn } from 'node:child_process'
import { openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  daemonStateFiles,
  isPidAlive,
  readPid,
  resolveSelfLauncher,
  stopDaemon,
  type SelfLauncher,
  type StopDaemonOptions,
} from './daemon.ts'

const NAME = 'dsh'

/** The reminder a live-instance start rejects with. */
const STOP_HINT = "run 'dsh web stop' first"

/** The readiness line the web app prints once its server is bound. */
const URL_PATTERN = /dsh web: (http:\/\/\S+)/u

/** How long `start` waits for the readiness URL before reporting the log instead. */
const DEFAULT_URL_TIMEOUT_MS = 15_000

/** Poll interval for the readiness line. */
const URL_POLL_INTERVAL_MS = 100

/** Options for the web control actions, injectable by tests. */
export interface WebControlOptions {
  /** Where the pid and log files live; defaults to the resolved `$DSH_HOME`. */
  baseDir?: string
  /** The self-relaunch command; defaults to the current process's own launcher. */
  launcher?: SelfLauncher
  /** How long `stop` waits for a graceful SIGTERM exit before SIGKILL. */
  killTimeoutMs?: number
  /** How long `start` waits for the readiness URL line before reporting the log instead. */
  urlTimeoutMs?: number
}

/**
 * Resolve the web server's state files.
 * @param options - control options (the base directory).
 * @returns the pid and log file paths.
 */
export function webStateFiles(options: WebControlOptions = {}): { pidFile: string; logFile: string } {
  return daemonStateFiles(options.baseDir ?? resolveDshHome(), 'web')
}

/**
 * Start `dsh --profile web` detached, relaunching the current CLI so the
 * booted web profile is exactly what an interactive foreground `dsh web --dev`
 * would provide — the same launcher flags and app arguments land in the child.
 * @param args - the forwarded web-app arguments.
 * @param options - control options (base directory, launcher, patch overlays).
 * @returns 0 on launch, 1 on any failure.
 */
export async function startWeb(
  args: readonly string[],
  { patchFiles = [], ...options }: WebControlOptions & { patchFiles?: readonly string[] } = {},
): Promise<number> {
  const { pidFile, logFile } = webStateFiles(options)
  const running = readPid(pidFile)
  if (running !== undefined && isPidAlive(running)) {
    process.stderr.write(`${NAME}: web is already running (pid ${running}, pid file ${pidFile}); ${STOP_HINT}\n`)
    const url = findUrlInLog(logFile)
    if (url !== undefined) process.stdout.write(`dsh web: ${url}\n`)
    return 1
  }
  // The child inherits nothing from the shell: stdin drops, stdout/stderr
  // append to the log so the launching terminal can close freely.
  let logFd: number
  try {
    logFd = openSync(logFile, 'a')
  } catch (error) {
    process.stderr.write(`${NAME}: cannot open log ${logFile}: ${(error as Error).message}\n`)
    return 1
  }
  // The readiness URL line must come from this launch, so remember where the
  // log starts before the child appends; the wait below only reads the child's
  // own output.
  const startOffset = statSyncSafe(logFile)
  const launcher = options.launcher ?? resolveSelfLauncher()
  const child = spawn(launcher.execPath, [
    ...launcher.loaderArgs,
    launcher.script,
    '--profile',
    'web',
    ...patchFiles.flatMap(file => ['--patch', file]),
    ...args,
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  })
  try {
    writeFileSync(pidFile, `${child.pid}\n`)
  } catch (error) {
    process.stderr.write(`${NAME}: cannot write pid file ${pidFile}: ${(error as Error).message}\n`)
    if (child.pid !== undefined && isPidAlive(child.pid)) child.kill('SIGKILL')
    return 1
  }
  child.unref()
  process.stdout.write(`${NAME}: web started (pid ${child.pid}); log: ${logFile}\n`)
  const url = await waitForUrl(logFile, startOffset, options.urlTimeoutMs ?? DEFAULT_URL_TIMEOUT_MS, child)
  if (typeof url === 'string') {
    process.stdout.write(`dsh web: ${url}\n`)
    return 0
  }
  // No URL and the child already gave up: report its fail-loud summary right
  // away (a stray server hogging the composed port is the common cause) and
  // signal failure, instead of making the user dig through the log.
  if (typeof url === 'number' && url !== 0) {
    const summary = findErrorSummary(logFile, startOffset)
    process.stderr.write(
      `${NAME}: web server exited before becoming ready (code ${url})${summary === undefined ? '' : `: ${summary}`}; see the log: ${logFile}\n`,
    )
    rmSync(pidFile, { force: true }) // the recorded pid is dead; keep the launcher honest
    return 1
  }
  process.stdout.write(`${NAME}: web is starting — URL line not ready yet; see the log: ${logFile}\n`)
  return 0
}

/** The log file's size at a moment, 0 when it does not exist yet. */
function statSyncSafe(logFile: string): number {
  try {
    return statSync(logFile).size
  } catch {
    return 0
  }
}

/** The most recent readiness URL in the log, if any. */
function findUrlInLog(logFile: string): string | undefined {
  try {
    return URL_PATTERN.exec(readFileSync(logFile, 'utf8'))?.[1]
  } catch {
    return undefined
  }
}

/**
 * Poll the log for the web app's readiness URL line, reading only the bytes
 * appended after `startOffset` so a previous run's line cannot satisfy the
 * wait. There is no timeout race here: the caller's deadline is the upper
 * bound, and the wait also ends when the child exits.
 * @param logFile - the web daemon's log file.
 * @param startOffset - the log size when this launch began appending.
 * @param timeoutMs - how long to wait for the URL line.
 * @param child - the spawned server process; its exit terminates the wait.
 * @returns the readiness URL, the child's exit code when it terminated first, or `undefined` on timeout.
 */
function waitForUrl(
  logFile: string,
  startOffset: number,
  timeoutMs: number,
  child: ReturnType<typeof spawn>,
): Promise<string | undefined | number> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    // The exit code arrives with the event itself; reading `child.exitCode`
    // later races the property assignment.
    child.once('exit', (code) => {
      resolve(code ?? 0)
    })
    const poll = (): void => {
      try {
        const size = statSync(logFile).size
        if (size > startOffset) {
          const match = URL_PATTERN.exec(readFileSync(logFile, 'utf8').slice(startOffset))
          if (match?.[1] !== undefined) {
            resolve(match[1])
            return
          }
        }
      } catch {
        // The log can be momentarily unreadable; keep polling until the deadline.
      }
      if (Date.now() >= deadline) {
        resolve(undefined)
        return
      }
      // Poll fallback for an exit that fired between the last poll and the
      // listener registration timing.
      if (child.exitCode !== null) {
        resolve(child.exitCode)
        return
      }
      setTimeout(poll, URL_POLL_INTERVAL_MS)
    }
    poll()
  })
}

/** The most informative fail-loud line in the log segment, if any. */
function findErrorSummary(logFile: string, startOffset: number): string | undefined {
  try {
    const segment = readFileSync(logFile, 'utf8').slice(startOffset)
    const lines = segment.split('\n').map(line => line.trim()).filter(line => line !== '').reverse()
    // Fail-loud summaries read `dsh: stage: detail`; a raw `Error: ...` line
    // is the fallback for crashes that bypass the launcher's reporter.
    for (const line of lines) {
      if (line.startsWith(`${NAME}: `) && !line.startsWith(`${NAME}: web`)) return truncate(line)
      if (line.startsWith('Error: ')) return truncate(line)
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Keep a diagnostic line from flooding the terminal. */
function truncate(line: string): string {
  return line.length > 240 ? `${line.slice(0, 237)}...` : line
}

/**
 * Stop the running web server: SIGTERM, escalate to SIGKILL after
 * {@link WebControlOptions.killTimeoutMs}, remove the pid file.
 * @param options - control options (base directory, kill timeout).
 * @returns 0 when stopped, 1 when nothing was recorded or the process survives SIGKILL.
 */
export async function stopWeb(options: WebControlOptions = {}): Promise<number> {
  const { pidFile } = webStateFiles(options)
  const opts: StopDaemonOptions = { pidFile, name: 'web' }
  if (options.killTimeoutMs !== undefined) opts.killTimeoutMs = options.killTimeoutMs
  return await stopDaemon(opts)
}
