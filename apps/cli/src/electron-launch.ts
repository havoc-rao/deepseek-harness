/**
 * `dsh electron` — spawn the desktop app over the same web profile `dsh web`
 * boots. The CLI stays the launcher: it resolves the in-repo
 * `@deepseek-ai/dsh-electron` package and its vendored `electron` binary,
 * spawns Electron with the app directory as its app path, forwards SIGINT and
 * SIGTERM to the child, and exits with the child's code. The app's own main
 * process then boots the shared `web` profile inside the Electron renderer,
 * so a browser surface and the desktop surface share every requested plugin
 * tree; nothing about the harness tree lives in this process.
 * @module @deepseek-ai/dsh/electron-launch
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Options for {@link runElectron}, injectable by tests. */
export interface ElectronLaunchOptions {
  /** The desktop-app directory; defaults to {@link resolveAppDir}. */
  appDir?: string
  /** The electron executable; defaults to {@link resolveElectronBinary}. */
  binary?: string
  /** The headless/windowed stdout sink electron logs through; defaults to the CLI's own stdio. */
  stdio?: 'inherit' | 'ignore'
}

/**
 * Spawn the desktop app and wait for its exit.
 * @param args - the invocation's surviving arguments, forwarded to the electron main process.
 * @param options - overrides (tests) and stdio policy.
 * @returns the child's exit code, or 1 on any launch failure.
 */
export async function runElectron(args: readonly string[], options: ElectronLaunchOptions = {}): Promise<number> {
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
  // Electron's first non-option argument is the app path (like `electron .`).
  const child = spawn(binary, [appDir, ...args], { stdio: options.stdio ?? 'inherit' })
  const forward = (signal: NodeJS.Signals): void => {
    if (child.exitCode === null) child.kill(signal)
  }
  const onInterrupt = (): void => { forward('SIGINT') }
  const onTerminate = (): void => { forward('SIGTERM') }
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  try {
    return await new Promise<number>((resolve) => {
      child.on('error', (error) => {
        process.stderr.write(`${NAME}: failed to spawn electron at ${binary}: ${error.message}\n`)
        resolve(1)
      })
      child.on('exit', (code, signal) => {
        // A signal-delivered exit (the target leaked past our forwarding) is
        // a failure of the child, not our normal handshake, so report 1.
        resolve(signal === null ? code ?? 0 : 1)
      })
    })
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
  }
}
