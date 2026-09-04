/**
 * Shared pid-file daemon plumbing for the launcher-controlled long-running
 * surfaces (`dsh electron`, `dsh web`): pid/log state-file naming under a
 * base directory, pid liveness probing, the common stop protocol —
 * SIGTERM, escalation to SIGKILL after a grace period, then removal of the
 * pid file — and the self-relaunch command both detached launchers spawn
 * themselves with. The controlled process itself is detached by each
 * surface's launcher; this module owns none of the process starting.
 * @module @deepseek-ai/dsh/daemon
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The launcher's own name, leading every user-facing message. */
const NAME = 'dsh'
/** Wait this long for a graceful SIGTERM exit before SIGKILL. */
const DEFAULT_KILL_TIMEOUT_MS = 3000
/** When a live process outlives SIGKILL too, report failure after this wall clock. */
const SIGKILL_GRACE_MS = 3000

/** The pid-file/log-file pair for one daemon under a state directory. */
export interface DaemonStateFiles {
  /** Absolute pid-file path. */
  pidFile: string
  /** Absolute log-file path. */
  logFile: string
}

/**
 * Resolve the pid-file and log-file for one daemon named `name` under a state
 * base (`$DSH_HOME` in production).
 * @param base - the state directory the daemon's files live in.
 * @param name - the daemon stem, e.g. `electron` or `web`.
 * @returns the pid and log file paths.
 */
export function daemonStateFiles(base: string, name: string): DaemonStateFiles {
  return { pidFile: join(base, `${name}.pid`), logFile: join(base, `${name}.log`) }
}

/**
 * Test whether another process is live with the given pid.
 * @param pid - the process id to probe.
 * @returns `true` when the process is alive (signal reachable), else `false`.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Read the pid the last `start` recorded.
 * @param pidFile - the pid-file path.
 * @returns the recorded pid, or `undefined` when the file is absent or corrupt.
 */
export function readPid(pidFile: string): number | undefined {
  if (!existsSync(pidFile)) return undefined
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/**
 * How this CLI relaunches itself: the same Node executable that runs us, this
 * process's own entry script (its argv[1]), and the node loader hooks the
 * current process started under (so a source-launch under `--import tsx` —
 * this entry's `.ts` sources — stays loadable in the child, while a built-bin
 * boot carries none). Reusing the current process's launcher keeps
 * source-launch and built-bin boots self-consistent: the child is started
 * exactly the way we were.
 */
export interface SelfLauncher {
  /** The Node executable to spawn. */
  execPath: string
  /** The script the child passes as its first argument (this CLI's entry). */
  script: string
  /** Node `--import`/`--loader`/`--require` switches to repeat before the script. */
  loaderArgs: readonly string[]
}

/**
 * The default self-relaunch command: the current entry script, Node
 * executable, and the loader hooks this process booted through. A bare
 * directory run — no argv[1] — cannot relaunch itself consistently, so it
 * fails loud instead of guessing.
 * @returns the launcher of the current process.
 */
export function resolveSelfLauncher(): SelfLauncher {
  const script = process.argv[1]
  if (script === undefined) {
    throw new Error('dsh: cannot relaunch this process — argv[1] is missing')
  }
  const execArgv = process.execArgv
  const loaderArgs: string[] = []
  for (let i = 0; i < execArgv.length; i++) {
    const argument = execArgv[i]
    if (argument === undefined) continue // noUncheckedIndexedAccess: impossible while i < length
    if (argument === '--import' || argument === '--loader' || argument === '--require') {
      loaderArgs.push(argument)
      const value = execArgv[i + 1]
      if (value !== undefined) {
        loaderArgs.push(value)
        i++
      }
    } else if (argument.startsWith('--import=') || argument.startsWith('--loader=') || argument.startsWith('--require=')) {
      loaderArgs.push(argument)
    }
  }
  return { execPath: process.execPath, script, loaderArgs }
}

/** Options for {@link stopDaemon}. */
export interface StopDaemonOptions {
  /** The pid-file path the stop targets. */
  pidFile: string
  /** The daemon's display name in messages (e.g. `electron` or `web`). */
  name: string
  /** How long to wait for a graceful SIGTERM exit before SIGKILL. */
  killTimeoutMs?: number
  /** Override for stdout (tests). */
  stdout?: (message: string) => void
  /** Override for stderr (tests). */
  stderr?: (message: string) => void
}

/**
 * Stop a recorded daemon process: SIGTERM, escalate to SIGKILL after
 * {@link StopDaemonOptions.killTimeoutMs}, remove the pid file. A stale pid
 * file (no live process) is removed silently; a process surviving SIGKILL is
 * reported as failure.
 * @param options - the pid file, display name, kill timeout, and output sinks.
 * @returns 0 when stopped, 1 when nothing was recorded or the process survives SIGKILL.
 */
export async function stopDaemon(options: StopDaemonOptions): Promise<number> {
  const { pidFile, name } = options
  const out = options.stdout ?? ((message: string): void => { process.stdout.write(`${message}\n`) })
  const err = options.stderr ?? ((message: string): void => { process.stderr.write(`${message}\n`) })
  const pid = readPid(pidFile)
  if (pid === undefined) {
    err(`${NAME}: no ${name} pid file at ${pidFile}; nothing to stop`)
    return 1
  }
  if (!isPidAlive(pid)) {
    rmSync(pidFile, { force: true })
    out(`${NAME}: no live ${name} process (stale pid ${pid}, pid file removed)`)
    return 0
  }
  out(`${NAME}: stopping ${name} (pid ${pid})...`)
  process.kill(pid, 'SIGTERM')
  const grace = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS
  const deadline = Date.now() + grace
  while (isPidAlive(pid) && Date.now() < deadline) {
    await sleep(150)
  }
  if (isPidAlive(pid)) {
    out(`${NAME}: ${name} did not exit after ${grace}ms, sending SIGKILL`)
    process.kill(pid, 'SIGKILL')
    const settle = Date.now() + SIGKILL_GRACE_MS
    while (isPidAlive(pid) && Date.now() < settle) {
      await sleep(150)
    }
    if (isPidAlive(pid)) {
      err(`${NAME}: ${name} (pid ${pid}) is still alive after SIGKILL — check processes manually`)
      return 1
    }
  }
  rmSync(pidFile, { force: true })
  out(`${NAME}: ${name} stopped`)
  return 0
}

/** Pause for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
