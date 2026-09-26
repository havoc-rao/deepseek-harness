/**
 * Pack the desktop app into a distributable macOS `.app` (+ optional `.dmg`),
 * without electron-builder. Electron's own install already contains a complete
 * `Electron.app` bundle; this script rebuilds it into `dsh.app`:
 *
 *   1. `pnpm deploy --prod --legacy` materializes the workspace dependency
 *      closure (`@deepseek-ai/dsh-*`, vendored cordis) as a real `node_modules`
 *      tree under `dist/pack`. The built `lib/`, `config/`, and `assets/` are
 *      copied alongside, and `package.json` is rewritten to match.
 *   2. The Electron runtime (`dist/Electron.app`) is copied whole, its
 *      Info.plist repointed at the dsh identity, its main binary renamed to
 *      `dsh`, and the staged code tree mounted at `Contents/Resources/app/`.
 *      `asar` is skipped on purpose: the desktop host resolves its plugin
 *      closure through real paths and symlinks packages into `~/.dsh`.
 *   3. `DSH_DMG=1` additionally builds `dsh-<version>.dmg` with macOS's own
 *      `hdiutil` (no third-party tooling).
 *
 * The pack dir is never deleted by this script — a leftover `dist/pack`
 * aborts with an instruction so builds stay reproducible and nothing is
 * destroyed implicitly.
 * @module @deepseek-ai/dsh-electron/scripts/pack-dist
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // apps/electron/scripts
const pkgRoot = resolve(here, '..') // apps/electron
const repoRoot = resolve(pkgRoot, '..', '..')
const distDir = join(pkgRoot, 'dist')
const packDir = join(distDir, 'pack')
const releaseDir = join(distDir, 'release')
const appDir = join(releaseDir, 'dsh.app')

/** Forward a process and fail loud with its output on non-zero exit. */
function run(command, args, cwd = pkgRoot) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    // Non-interactive pipeline: never ask before purging a previous staging.
    // npm_config_ignore_scripts is read by pnpm itself (unlike the `--ignore-scripts`
    // CLI flag, which is dropped for the nested `install --production` that pnpm
    // deploy runs): the root workspace postinstall (lefthook installation)
    // must not run against a dependency-only staging tree.
    env: {
      ...process.env,
      CI: 'true',
      npm_config_confirm_modules_purge: 'false',
      npm_config_ignore_scripts: 'true',
    },
  })
}

if (existsSync(packDir)) {
  console.error(`pack directory already exists: ${packDir}\nremove it first to rebuild (e.g. 'rm -rf ${join('apps', 'electron', 'dist')}')`)
  process.exit(1)
}
mkdirSync(packDir, { recursive: true })

// Stage 1: materialize the dependency closure. `pnpm deploy` needs `--legacy`
// unless the workspace sets `inject-workspace-packages` (pnpm v10+ refuses).
// Script suppression happens through the environment (see run()) so the root
// postinstall never runs against the dependency-only staging tree. Caveat:
// legacy deploy recreates the source package's node_modules (dev deps are
// pruned); restore afterwards with `pnpm install`.
run('pnpm', ['--filter', '@deepseek-ai/dsh-electron', 'deploy', '--prod', '--legacy', '--ignore-scripts', packDir], repoRoot)

// Stage 2: ship the built bundle, overlays, and metadata into the deploy root.
for (const entry of ['lib', 'config', 'assets']) {
  cpSync(join(pkgRoot, entry), join(packDir, entry), { recursive: true })
}
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'))
// The staged package.json keeps `main` pointing at the bundled lib main and
// records the same identity; dev dependencies do not ship.
delete pkg.devDependencies
writeFileSync(join(packDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

// Stage 2b: keep only what a published release ships. `pnpm deploy` clones the
// whole workspace source (src/, scripts/, manifests); those are build-only and
// must not ride inside the app payload. Deletion is confined to dist/pack —
// the intermediate build artifact, never source.
for (const stale of ['src', 'scripts', 'tsconfig.json', 'tsdown.config.ts', 'electron-builder.yml', 'README.md', 'README.zh.md', 'README.i18n.yaml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  rmSync(join(packDir, stale), { recursive: true, force: true })
}

// Stage 3: reassemble Electron's own app bundle into dsh.app. The Electron
// runtime is copied from the installed store — never mutated in place.
const electronDist = findElectronDist()
if (electronDist === undefined) {
  console.error('electron runtime not found — run `pnpm install` first')
  process.exit(1)
}

mkdirSync(join(appDir, 'Contents'), { recursive: true })
const srcContents = join(electronDist, 'Electron.app', 'Contents')
for (const entry of readdirSync(srcContents)) {
  cpSync(join(srcContents, entry), join(appDir, 'Contents', entry), { recursive: true })
}
// The executable: Electron's own binary, renamed. Info.plist points the app
// at the new name; Resources/ gets the staged code tree as the loadable app.
cpSync(join(srcContents, 'MacOS', 'Electron'), join(appDir, 'Contents', 'MacOS', 'dsh'))
writeFileSync(join(appDir, 'Contents', 'Info.plist'), plistXml(pkg.version ?? '0.0.0'))
const resourcesDir = join(appDir, 'Contents', 'Resources')
cpSync(join(pkgRoot, 'assets', 'icon.icns'), join(resourcesDir, 'icon.icns'))
const payloadDir = join(resourcesDir, 'app')
mkdirSync(payloadDir, { recursive: true })
cpSync(packDir, payloadDir, { recursive: true })
console.log(`packed app: ${appDir}`)

// Optional DMG via system hdiutil.
if (process.env.DSH_DMG === '1') {
  const dmg = join(releaseDir, `dsh-${pkg.version ?? '0.0.0'}.dmg`)
  run('hdiutil', ['create', '-volname', 'dsh', '-srcfolder', appDir, '-ov', '-format', 'UDZO', dmg])
  console.log(`packed dmg: ${dmg}`)
}

/** Locate the installed electron runtime across the usual install layouts. */
function findElectronDist() {
  const direct = [
    join(pkgRoot, 'node_modules', 'electron', 'dist'), // this package's own install
    join(repoRoot, 'node_modules', 'electron', 'dist'), // hoisted install
  ]
  for (const dir of direct) {
    if (existsSync(join(dir, 'Electron.app'))) return dir
  }
  // pnpm store layout: node_modules/.pnpm/electron@*<ver>/node_modules/electron/dist
  const pnpmDir = join(repoRoot, 'node_modules', '.pnpm')
  if (existsSync(pnpmDir)) {
    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith('electron@')) continue
      const dir = join(pnpmDir, entry, 'node_modules', 'electron', 'dist')
      if (existsSync(join(dir, 'Electron.app'))) return dir
    }
  }
  return undefined
}

/** Minimal Info.plist for a Developer-Tools app. */
function plistXml(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>dsh</string>
  <key>CFBundleDisplayName</key><string>dsh</string>
  <key>CFBundleIdentifier</key><string>ai.deepseek.dsh</string>
  <key>CFBundleExecutable</key><string>dsh</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSRequiresAquaSystemAppearance</key><false/>
</dict>
</plist>
`
}
