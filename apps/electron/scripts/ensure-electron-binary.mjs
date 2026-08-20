/**
 * Idempotent postinstall repair for the Electron platform binary.
 *
 * `pnpm-workspace.yaml` approves the `electron` package's own postinstall
 * (which downloads the platform binary into `dist/` and writes `path.txt`),
 * but pnpm 11 does not re-run a store package's postinstall once the package
 * is already materialized — so a later `pnpm install` can leave the binary
 * missing and `dsh electron` fails with "electron binary is not installed".
 * The workspace's own postinstall runs unconditionally, so this hook bridges
 * exactly that gap: check, and when the binary is absent, run the electron
 * package's `install.js` in place.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(appRoot, 'node_modules', 'electron')
const installJs = join(electronDir, 'install.js')

// Binary present — nothing to do.
if (existsSync(join(electronDir, 'path.txt')) && existsSync(join(electronDir, 'dist'))) {
  process.exit(0)
}
// electron not installed at all (fresh clone before first full install) —
// not this hook's job; a later stage installs it.
if (!existsSync(installJs)) {
  process.exit(0)
}
console.log('[dsh-electron] Electron binary missing — running install.js to fetch it')
const result = spawnSync(process.execPath, [installJs], { cwd: electronDir, stdio: 'inherit' })
process.exit(result.status ?? 1)
