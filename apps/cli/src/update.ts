/**
 * `dsh update` — rebuild a profile's link-installed plugins from their source
 * directories. A plugin installed through `link:`/`file:` is a live symlink:
 * the profile keeps pointing at the checkout, so refreshing the profile means
 * running the plugin's own build in place, not reinstalling anything. Each
 * plugin runs its `build` script (fallbacks to `prepare` when the package has
 * no build step), with optional `pnpm install` first for dependency changes
 * and optional `git pull --ff-only` for git-hosted checkouts.
 *
 * Without `--profile`, the command scans `$DSH_HOME/profiles` for every linked
 * plugin, fetches each git remote (read-only status observation) and lists
 * them with their ahead/behind/dirty state, then rebuilds the ones the user
 * picks interactively.
 * @module @deepseek-ai/dsh/update
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { join, resolve } from 'node:path'
import { readProfileManifest, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const NAME = 'dsh'

/**
 * The build step a plugin package ships, `build` preferred over `prepare`
 * (prepare is the pnpm install-time hook and often a lighter bundle-only
 * step; the explicit build script is the complete artifact).
 * @param dir - the plugin package directory.
 * @returns the script name, or `undefined` when the package builds nothing.
 */
function buildScript(dir: string): string | undefined {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
  if (manifest.scripts?.build !== undefined) return 'build'
  if (manifest.scripts?.prepare !== undefined) return 'prepare'
  return undefined
}

/**
 * Run one pnpm command in a plugin directory with inherited stdio.
 * @param dir - the plugin package directory.
 * @param args - pnpm arguments, verbatim.
 * @returns the pnpm exit code (127 when pnpm is missing on PATH).
 */
function runPnpm(dir: string, args: readonly string[]): number {
  const result = spawnSync('pnpm', args, {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to rebuild linked plugins\n`)
      return 127
    }
    throw result.error
  }
  return result.status ?? 1
}

/** A profile's linked plugin checkout, ready to rebuild. */
interface LinkedPlugin {
  /** The profile the plugin is bundled into. */
  profile: string
  /** The dependency key in the profile manifest. */
  packageName: string
  /** The checkout directory the `link:`/`file:` spec points at. */
  dir: string
  /** The raw dependency spec, for diagnostics. */
  spec: string
}

/** Git working-tree state of one checkout, from `git status -sb`. */
interface GitState {
  /** false when the directory is not a git repository. */
  isGit: boolean
  /** The current branch (or detached commit). */
  branch: string
  /** Commits ahead of the upstream, 0 when none. */
  ahead: number
  /** Commits behind the upstream, 0 when none. */
  behind: number
  /** true when tracked or untracked files are modified. */
  dirty: boolean
}

/**
 * Read a checkout's git state from `git status -sb` without spawning per-call
 * overhead; the single command reports branch, upstream delta, and dirty files.
 * @param dir - the plugin package directory.
 * @returns the parsed state (`isGit: false` when git is absent or not a repo).
 */
function gitState(dir: string): GitState {
  const base: GitState = { isGit: false, branch: '', ahead: 0, behind: 0, dirty: false }
  const result = spawnSync('git', ['status', '-sb', '--porcelain=v1'], { cwd: dir, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return base
  const lines = result.stdout.split('\n')
  const header = lines[0] ?? ''
  const match = /^## (?<branch>[^ .]+(?: \.?[^ .]+)*)(?:\.\.\.(?<upstream>\S+?))?(?: \[(?<meta>[^\]]+)\])?$/.exec(header)
  if (match?.groups?.branch === undefined) return base
  let ahead = 0
  let behind = 0
  for (const part of (match.groups.meta ?? '').split(',').map(part => part.trim())) {
    const aheadMatch = /^ahead (\d+)$/.exec(part)
    const behindMatch = /^behind (\d+)$/.exec(part)
    if (aheadMatch !== null) ahead = Number(aheadMatch[1])
    if (behindMatch !== null) behind = Number(behindMatch[1])
  }
  return {
    isGit: true,
    branch: match.groups.branch,
    ahead,
    behind,
    // Everything after the `##` header is a changed file.
    dirty: lines.slice(1).some(line => line.trim() !== ''),
  }
}

/**
 * Refresh a git checkout's view of the remote: `git fetch` (read-only) so
 * `status -sb` can report committed-but-unpulled changes. Failures (no
 * network, no git) are non-fatal — the plugin stays listed as its local state.
 * @param dir - the plugin checkout directory.
 * @returns true when the fetch succeeded.
 */
function fetchRemote(dir: string): boolean {
  const result = spawnSync('git', ['fetch', '--all', '--quiet'], { cwd: dir, stdio: 'ignore' })
  return result.error === undefined && result.status === 0
}

/**
 * Fast-forward a plugin checkout to its upstream: `git pull --ff-only` refuses
 * to merge, so local commits or conflicts surface as a nonzero exit instead of
 * an unrequested merge.
 * @param dir - the plugin checkout directory.
 * @returns true when the pull succeeded or the directory is not a git repo.
 */
function pullRemote(dir: string): boolean {
  const result = spawnSync('git', ['pull', '--ff-only', '--quiet'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' })
  return result.error !== undefined || result.status === 0
}

/**
 * Scan every profile under `$DSH_HOME/profiles` for `link:`/`file:`
 * dependencies and resolve each to its checkout directory. Registry-spec
 * dependencies and missing checkouts are skipped (a hooked-up one is listed
 * as its own diagnostics by the per-plugin rebuild).
 * @returns the linked plugins in stable profile-then-dependency order.
 */
function listLinkedPlugins(): LinkedPlugin[] {
  const home = resolveDshHome()
  const profilesDir = join(home, 'profiles')
  const plugins: LinkedPlugin[] = []
  if (!existsSync(profilesDir)) return plugins
  for (const profile of readdirSync(profilesDir).sort()) {
    // Skip entries that are not real profiles (the launcher-maintained flat
    // module fallback sits here as node_modules); resolveProfileDir rejects them.
    if (profile === '' || profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..'
      || profile === 'node_modules') continue
    const dir = resolveProfileDir(profile)
    if (!existsSync(join(dir, 'package.json'))) continue
    const dependencies = readProfileManifest(NAME, dir).dependencies ?? {}
    for (const [packageName, spec] of Object.entries(dependencies)) {
      const match = /^(?:link|file):(?<target>.+)$/.exec(spec)
      if (match?.groups?.target === undefined) continue
      // resolve, not join: an absolute target (link:/abs/path) stays absolute,
      // a relative one (link:../dir) anchors on the profile directory.
      const pluginDir = resolve(dir, match.groups.target)
      if (!existsSync(join(pluginDir, 'package.json'))) continue
      plugins.push({ profile, packageName, dir: pluginDir, spec })
    }
  }
  return plugins
}

/**
 * Rebuild one linked plugin: `git pull` when requested, `pnpm install` when
 * requested, then the package's build step.
 * @param plugin - the linked plugin to rebuild.
 * @param options - `install` runs `pnpm install` first; `pull` runs `git pull --ff-only` first.
 * @returns true when the plugin rebuilt cleanly.
 */
function rebuildPlugin(plugin: LinkedPlugin, options: { install: boolean; pull: boolean }): boolean {
  const script = buildScript(plugin.dir)
  if (script === undefined) {
    process.stderr.write(`${NAME}: ${plugin.packageName} declares no build or prepare script — nothing to run\n`)
    return true
  }
  if (options.pull && !pullRemote(plugin.dir)) {
    process.stderr.write(`${NAME}: git pull --ff-only failed in ${plugin.dir} — local changes may conflict; resolve and re-run\n`)
    return false
  }
  process.stderr.write(`${NAME}: rebuilding ${plugin.profile}/${plugin.packageName} (${plugin.dir}) with pnpm ${script}\n`)
  if (options.install && runPnpm(plugin.dir, ['install']) !== 0) return false
  return runPnpm(plugin.dir, ['run', script]) === 0
}

/**
 * Ask the user on the interactive terminal which listed plugins to rebuild.
 * @param count - the number of listed plugins (1-based input maps to indices).
 * @returns the selected plugin indices in ascending order (empty for `q`).
 */
async function choosePlugins(count: number): Promise<number[]> {
  const rl = createInterface({ input: stdin, output: stdout })
  const line = (await rl.question(
    'pick plugins to rebuild (comma/space-separated numbers, empty = all, q = quit): ',
  )).trim().toLowerCase()
  rl.close()
  if (line === '') return Array.from({ length: count }, (_, index) => index)
  if (line === 'q') return []
  const seen = new Set<number>()
  for (const token of line.split(/[\s,]+/).filter(Boolean)) {
    const value = Number(token)
    if (Number.isInteger(value) && value >= 1 && value <= count) seen.add(value - 1)
  }
  return [...seen].sort((a, b) => a - b)
}

/** One listed plugin plus the git summary line shown to the user. */
interface ListedPlugin {
  plugin: LinkedPlugin
  /** For non-git checkouts this is the directory without git markers. */
  label: string
}

/**
 * Fetch (read-only) every git checkout and build the interactive list labels.
 * @param plugins - the discovered linked plugins.
 * @returns entries with a label like `main ↓1 ↑2 ✖` or `(plain dir)`.
 */
function listWithGitState(plugins: LinkedPlugin[]): ListedPlugin[] {
  return plugins.map((plugin) => {
    const state = gitState(plugin.dir)
    if (!state.isGit) return { plugin, label: '(not a git repo)' }
    fetchRemote(plugin.dir)
    const fresh = gitState(plugin.dir)
    const parts: string[] = [fresh.branch]
    if (fresh.behind > 0) parts.push(`↓${fresh.behind}`)
    if (fresh.ahead > 0) parts.push(`↑${fresh.ahead}`)
    if (fresh.dirty) parts.push('✖')
    return { plugin, label: parts.join(' ') }
  })
}

/**
 * Rebuild a profile's linked plugins: resolve each `link:`/`file:` dependency
 * to its checkout, `git pull` and `pnpm install` first when requested, then
 * the plugin's build step.
 * @param profile - the profile name.
 * @param packages - package names to rebuild; empty rebuilds every linked dependency.
 * @param install - run `pnpm install` in each plugin directory before its build script.
 * @param pull - run `git pull --ff-only` in each plugin checkout before building.
 * @returns 0 when every requested plugin rebuilt cleanly, non-zero otherwise.
 */
export function runUpdate(profile: string, packages: readonly string[], install: boolean, pull: boolean): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    process.stderr.write(`${NAME}: profile ${profile} does not exist at ${dir} — run 'dsh plugin --profile ${profile} add <package>' first\n`)
    return 1
  }
  const dependencies = readProfileManifest(NAME, dir).dependencies ?? {}
  const names = packages.length === 0 ? Object.keys(dependencies) : packages
  let failed = false
  for (const packageName of names) {
    const spec = dependencies[packageName]
    if (spec === undefined) {
      process.stderr.write(`${NAME}: ${packageName} is not a dependency of profile ${profile}\n`)
      failed = true
      continue
    }
    const match = /^(?:link|file):(?<target>.+)$/.exec(spec)
    if (match?.groups?.target === undefined) {
      // A registry spec (e.g. ^0.1.0) has no source checkout to rebuild; the
      // registry copy is frozen in node_modules and refreshed through pnpm.
      process.stderr.write(`${NAME}: ${packageName} is not a link installed dependency (${spec}) — skipping\n`)
      continue
    }
    const plugin: LinkedPlugin = {
      profile,
      packageName,
      dir: resolve(dir, match.groups.target),
      spec,
    }
    if (!existsSync(join(plugin.dir, 'package.json'))) {
      process.stderr.write(`${NAME}: ${packageName} checkout missing at ${plugin.dir} — re-link the package\n`)
      failed = true
      continue
    }
    if (!rebuildPlugin(plugin, { install, pull })) failed = true
  }
  return failed ? 1 : 0
}

/**
 * Interactive update: list every linked plugin across all profiles (github
 * fetch shows ahead/behind), rebuild the user's selection.
 * @param install - run `pnpm install` in each selected plugin directory first.
 * @param pull - run `git pull --ff-only` in each selected checkout first.
 * @returns 0 when every selected plugin rebuilt cleanly, non-zero otherwise; exits
 * 1 when nothing is linked or the choice is invalid.
 */
export async function runUpdateInteractive(install: boolean, pull: boolean): Promise<number> {
  const plugins = listLinkedPlugins()
  if (plugins.length === 0) {
    process.stderr.write(`${NAME}: no linked plugins found under ${join(resolveDshHome(), 'profiles')} — add one with 'dsh plugin --profile <name> add <package>'\n`)
    return 1
  }
  const listed = listWithGitState(plugins)
  process.stderr.write(`${NAME}: linked plugins:\n`)
  for (const [index, entry] of listed.entries()) {
    process.stderr.write(`  [${index + 1}] ${entry.plugin.profile}/${entry.plugin.packageName}  ${entry.label}\n`)
  }
  if (!stdin.isTTY) {
    process.stderr.write(`${NAME}: interactive selection needs a terminal — name the profile with --profile <name> instead\n`)
    return 1
  }
  const chosen = await choosePlugins(plugins.length)
  if (chosen.length === 0) {
    process.stderr.write(`${NAME}: nothing selected — no plugins rebuilt\n`)
    return 0
  }
  let failed = false
  for (const index of chosen) {
    // noUncheckedIndexedAccess: the picker only emits indices within range.
    const plugin = plugins[index]
    if (plugin !== undefined && !rebuildPlugin(plugin, { install, pull })) failed = true
  }
  return failed ? 1 : 0
}
