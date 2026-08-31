/**
 * Regenerate the ios/ native project from Capacitor's official SPM template.
 *
 * Why not `cap add ios`: Capacitor CLI 7.6.8's preflight checks CocoaPods
 * unconditionally on macOS, and its `--packagemanager SPM` option is broken
 * (the value is lowercased before comparing against 'SPM', so the flag never
 * selects the SPM dependency branch). Extracting the SPM template directly
 * and letting `cap sync` regenerate CapApp-SPM/Package.swift reproduces the
 * same project without CocoaPods and without a pod stub.
 *
 * The template's PRODUCT_BUNDLE_IDENTIFIER defaults to com.getcapacitor.App;
 * rewrite it to capacitor.config.json's appId so installed identifiers match
 * the configured app.
 */
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const require = createRequire(resolve(root, 'package.json'))

const cliEntry = require.resolve('@capacitor/cli') // dist/index.js
const assetsDir = resolve(dirname(dirname(cliEntry)), 'assets')
const template = resolve(assetsDir, 'ios-spm-template.tar.gz')
const iosDir = resolve(root, 'ios')
const pbxproj = resolve(iosDir, 'App', 'App.xcodeproj', 'project.pbxproj')

await rm(iosDir, { recursive: true, force: true })
await mkdir(iosDir, { recursive: true })
execFileSync('tar', ['xzf', template, '-C', iosDir], { stdio: 'inherit' })

const { appId } = JSON.parse(await readFile(resolve(root, 'capacitor.config.json'), 'utf8'))
const project = await readFile(pbxproj, 'utf8')
const rewritten = project.replaceAll('com.getcapacitor.App', appId)
if (rewritten === project) {
  throw new Error(`init-ios: PRODUCT_BUNDLE_IDENTIFIER not found in ${pbxproj}`)
}
await writeFile(pbxproj, rewritten)

console.log(`init-ios: extracted ${template} to ${iosDir}, bundle id set to ${appId}`)
console.log('init-ios: next run `pnpm sync` to copy www and regenerate CapApp-SPM/Package.swift')