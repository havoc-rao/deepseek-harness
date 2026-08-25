#!/usr/bin/env node
/**
 * Build the GitHub-release tarball set for this fork.
 *
 * The official dsh release machinery (`scripts/release/`) is an npm-publication
 * view: every member must be `@deepseek-ai/*`, share one version, and publish a
 * payload with no source maps. This fork adds two things that do not fit that
 * view, so this script builds a GitHub-distribution view instead:
 *
 *   - `apps/electron` — a private desktop app (`@deepseek-ai/dsh-electron`)
 *     that ships source and maps; it is packed separately here and never joins
 *     the npm-style family pack.
 *   - `dsh-web-app` carries a `link:` dev dependency on the sibling
 *     `@havocrao/dsh-code-finder`, which npm rejects (EUNSUPPORTEDPROTOCOL), so
 *     it is stripped before packing and restored after.
 *
 * The personal-scope `@havocrao/dsh-client-workspace-logo` plugin lives in
 * `packages/experimental/`, which the dsh family glob (`!(experimental)`)
 * already excludes; nothing here needs to touch it.
 *
 * The script temporarily adapts the tree (renames electron's package.json out
 * of the family glob, strips one dependency), runs the official pack steps,
 * packs electron on its own, restores the tree, and verifies the packed
 * install. On GitHub Actions the runner is throwaway, so restore only matters
 * locally.
 *
 * Usage:
 *   node scripts/release-github.mjs            # build dist/github
 *   node scripts/release-github.mjs --no-verify
 *   node scripts/release-github.mjs --exclude  # adapt the tree only (for bump)
 *   node scripts/release-github.mjs --restore  # undo a failed local run
 *
 * `--exclude` performs only the tree adaptation (excluding electron and
 * stripping the dependency) without packing; the release workflow runs it
 * before `release:dsh` so the bump sees the same clean family view. The default
 * mode is idempotent over an already-adapted tree.
 *
 * Outputs (all under dist/github/):
 *   npm/        the dsh family tarballs (npm-installable, no code-finder)
 *   vendor/     the vendored framework tarballs
 *   landlock/   the Landlock entry tarball
 *   electron/   the electron app tarball
 *
 * Exit codes: 0 success; 1 any failure (the tree is restored before returning).
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'dist/github')

/** Private desktop app packed separately; excluded from the family glob. */
const ELECTRON_DIR = 'apps/electron'
/** Web app that carries the dev-only sibling dependency into its tarball. */
const WEB_APP_MANIFEST = 'packages/bundle/web-app/package.json'
/** The dev-only sibling dependency stripped before packing. */
const DEV_SPEC = '@havocrao/dsh-code-finder'

/** Run a command and fail loudly on a non-zero exit. */
function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: options.cwd ?? root, stdio: 'inherit', env: { ...process.env, ...options.env } })
}

/** Temporarily rename a package.json out of the family glob. */
function exclude(dir) {
  const source = join(root, dir, 'package.json')
  const hidden = `${source}.hidden`
  if (!existsSync(source)) return
  if (existsSync(hidden)) throw new Error(`${hidden} already exists; refusing to overwrite`)
  renameSync(source, hidden)
  console.log(`release-github: excluded ${dir}`)
}

/** Restore a renamed package.json. */
function include(dir) {
  const source = join(root, dir, 'package.json')
  const hidden = `${source}.hidden`
  if (!existsSync(hidden)) return
  renameSync(hidden, source)
  console.log(`release-github: restored ${dir}`)
}

/** Strip the dev-only dependency from the web app manifest, keeping a backup. */
function stripDependency() {
  const path = resolve(root, WEB_APP_MANIFEST)
  const backup = `${path}.dev.bak`
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const dependencies = manifest.dependencies ?? {}
  if (dependencies[DEV_SPEC] === undefined) return
  if (!existsSync(backup)) cpSync(path, backup)
  delete dependencies[DEV_SPEC]
  manifest.dependencies = dependencies
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`release-github: stripped ${DEV_SPEC} from ${WEB_APP_MANIFEST}`)
}

/** Restore the stripped dependency. */
function restoreDependency() {
  const path = resolve(root, WEB_APP_MANIFEST)
  const backup = `${path}.dev.bak`
  if (!existsSync(backup)) return
  cpSync(backup, path)
  rmSync(backup, { force: true })
  console.log(`release-github: restored ${WEB_APP_MANIFEST}`)
}

/** Undo every adaptation; safe to call after any failure. */
function restore() {
  include(ELECTRON_DIR)
  restoreDependency()
  // Renaming manifests makes pnpm rewrite the workspace lockfile (it drops the
  // renamed members). Local runs must not carry that diff; on GitHub Actions
  // the checkout is throwaway so this is a no-op there.
  try {
    execFileSync('git', ['checkout', '--', 'pnpm-lock.yaml'], { cwd: root, stdio: 'ignore' })
  } catch {
    // Not a git checkout (or lockfile already clean): nothing to undo.
  }
}

/** Adapt the tree for the release view (exclude + strip). */
function adapt() {
  exclude(ELECTRON_DIR)
  stripDependency()
}

/** Exclude only electron, leaving manifests untouched for a clean bump commit. */
function excludeElectronOnly() {
  exclude(ELECTRON_DIR)
  run('pnpm', ['install', '--lockfile-only'])
}

function main() {
  const args = process.argv.slice(2)
  const noVerify = args.includes('--no-verify')
  if (args.includes('--exclude')) {
    try {
      excludeElectronOnly()
      console.log('release-github: tree adapted for release (exclude-only)')
    } catch (error) {
      restore()
      throw error
    }
    return
  }
  if (args.includes('--restore')) {
    restore()
    console.log('release-github: tree restored')
    return
  }

  try {
    rmSync(out, { recursive: true, force: true })
    mkdirSync(join(out, 'npm'), { recursive: true })
    mkdirSync(join(out, 'vendor'), { recursive: true })
    mkdirSync(join(out, 'landlock'), { recursive: true })
    mkdirSync(join(out, 'electron'), { recursive: true })

    // Electron is not on the host/client build face, so build and pack it here
    // while its manifest is still in place.
    run('pnpm', ['--dir', 'apps/electron', 'run', 'build'])
    run('pnpm', ['--dir', 'apps/electron', 'pack', '--pack-destination', resolve(out, 'electron')])
    console.log('release-github: electron built and packed')

    // Adapt (idempotent over an already-adapted tree, e.g. after --exclude).
    adapt()
    // Keep the lockfile consistent with the adapted manifest so pnpm steps in
    // the family pack pass their dependency-consistency checks.
    run('pnpm', ['install', '--lockfile-only'])

    // Pack the dsh family and its cross-sequence peers.
    run('pnpm', ['run', 'release:pack', '--family', 'dsh', '--out', resolve(out, 'npm')])
    run('pnpm', ['run', 'release:pack', '--family', 'vendor', '--out', resolve(out, 'vendor')])
    run('pnpm', ['--dir', 'native/landlock-run', 'run', 'build:ts'])
    run('pnpm', ['--dir', 'native/landlock-run/packages/entry', 'pack', '--pack-destination', resolve(out, 'landlock')])
    console.log('release-github: family packs complete')

    // Restore the tree before verification so local state is always clean.
    restore()

    if (!noVerify) {
      run('pnpm', ['run', 'release:verify-packed-install', '--family', 'dsh',
        '--from', resolve(out, 'npm'), '--from', resolve(out, 'vendor'), '--from', resolve(out, 'landlock')])
    }
    console.log(`release-github: outputs in ${out}`)
  } catch (error) {
    restore()
    throw error
  }
}

main()
