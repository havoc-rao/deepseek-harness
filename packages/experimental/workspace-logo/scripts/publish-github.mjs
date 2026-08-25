/**
 * Publish the package to GitHub Packages (private by repo visibility), with
 * the workspace:"^" peer protocol rewritten to published ranges for the packed
 * manifest, then restored. The repo keeps workspace:"^" per monorepo
 * convention; npm does not rewrite workspace protocols (pnpm pack does), so
 * this script does it for the publish and reverts after.
 *
 * Requires an authenticated GitHub token in .npmrc or GH_TOKEN. The scope
 * (@havocrao) must match the GitHub account that owns the token and the
 * package name; package visibility follows the owning GitHub repository.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'package.json')
const raw = readFileSync(manifestPath, 'utf8')
const manifest = JSON.parse(raw)
const original = `${JSON.stringify(manifest, null, 2)}\n`
const peers = manifest.peerDependencies ?? {}
for (const key of Object.keys(peers)) peers[key] = '^0.1.1-rc.2'
// The vendored cordis ships at 4.x and is published as @deepseek-ai/cordis@4.0.1.
peers['@deepseek-ai/cordis'] = '^4.0.1'
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
try {
  execSync('npm publish --registry=https://npm.pkg.github.com', { stdio: 'inherit', cwd: root })
} finally {
  writeFileSync(manifestPath, original)
}
