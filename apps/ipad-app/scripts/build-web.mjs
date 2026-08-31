/**
 * Milestone-2 build: assemble a self-contained web bundle that the Capacitor
 * shell can serve without a host process.
 *
 * `dsh web` serves the real frontend by injecting a `__ModuleLoader__` queue
 * facade, two parser-blocking preloads (client-modules and client-runtime),
 * and the `__DSH_BOOT__` client-plugin graph into `apps/web`'s Vite dist, and
 * by serving each graph row's bundle at `/plugins/<id>/client.js`. This script
 * reproduces those exact artifacts statically:
 *
 *   1. build apps/web (vite) → dist/
 *   2. enumerate the browser roster from the web-app bundle patch
 *   3. compose the boot graph with the real helpers from
 *      @deepseek-ai/dsh-client-modules (graphRow shape, orderByModuleGraph,
 *      bootInjections)
 *   4. copy dist + every client bundle into web-dist/, and render the
 *      injections into web-dist/index.html exactly as the webserver's
 *      renderIndexInjections does (replicated here; provenance:
 *      packages/host/webserver/src/injections.ts)
 *
 * The result loads in WKWebView: relative /assets and /plugins paths resolve
 * against the Capacitor origin, which serves files from the app bundle.
 * Sessions still need a reachable harness — milestone 3.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootInjections, orderByModuleGraph } from '@deepseek-ai/dsh-client-modules'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const repo = resolve(root, '..', '..')
const webApp = resolve(repo, 'apps', 'web')
const bundleDir = resolve(repo, 'packages', 'bundle', 'web-app')
const baseDir = resolve(bundleDir, '..', 'base')
const patchYml = resolve(bundleDir, 'cordis.patch.yml')
const outDir = resolve(root, 'web-dist')
// The active web profile (machine-specific): its bundle stack declares the
// extra plugins the real `dsh web` serves here (e.g. dsh-better-sidebar,
// workspace-logo). Override with DSH_IPAD_PROFILE_DIR; absent → base+web-app only.
const profileDir = process.env.DSH_IPAD_PROFILE_DIR
  ?? resolve(process.env.HOME ?? '', '.dsh', 'profiles', 'web')
// Three anchors: base rows (api-gateway, typert) resolve only through the base
// bundle's node_modules; web rows through the web-app bundle's; profile
// bundles (tarball/link installs) through the profile's node_modules.
const requireAnchors = [
  createRequire(join(bundleDir, 'package.json')),
  createRequire(join(baseDir, 'package.json')),
  createRequire(join(profileDir, 'package.json')),
]

/** Resolve `spec` through the bundle-order anchors, returning the first hit. */
function resolveSpec(spec) {
  for (const anchor of requireAnchors) {
    try {
      return { path: anchor.resolve(spec), anchor }
    } catch {
      // Try the next layer.
    }
  }
  return undefined
}

const shortHash = (input) => createHash('sha1').update(input).digest('hex').slice(0, 12)

/**
 * Compat patch for dsh-better-sidebar's WebSocket endpoints. The plugin builds
 * socket URLs as `new URL(path, location.origin)` then swaps the protocol to
 * ws(s):; under a non-special scheme (capacitor://) the WHATWG protocol setter
 * silently no-ops, so WebKit's WebSocket constructor rejects the resulting
 * URL with "The string did not match the expected pattern" at plugin load.
 * The patch anchors the URL on an explicit http(s) origin and keeps the
 * protocol swap on a special scheme, where the setter works. Upstream fix
 * belongs in the plugin's src/client/*.ts; this keeps the shipped bundle
 * functional until then.
 * @param content - the bundle text.
 * @param bundleName - for warnings.
 * @returns the patched text.
 */
function patchBetterSidebarWsUrls(content, bundleName) {
  const originBase = '(location.protocol === "https:" ? "https://" : "http://") + location.host'
  const protocolSwap = 'location.protocol === "https:" ? "wss:" : "ws:"'
  const targets = [
    ['CMD_W_CHANNEL_PATH', 'CMD_W_CHANNEL_PATH'],
    ['"/sidebar/ws/agent-terminals"', '"/sidebar/ws/agent-terminals"'],
    ['"/sidebar/ws/agent-opens"', '"/sidebar/ws/agent-opens"'],
  ]
  let out = content.toString('utf8')
  for (const [pathExpr, label] of targets) {
    const from = `const url = new URL(${pathExpr}, location.origin);`
    if (!out.includes(from)) {
      console.warn(`build-web: ${bundleName} changed; ${label} pattern not found, patch skipped`)
      continue
    }
    out = out.replaceAll(
      from,
      `const url = new URL(${pathExpr}, ${originBase});`,
    )
  }
  const swapFrom = `url.protocol = url.protocol === "https:" ? "wss:" : "ws:";`
  out = out.replaceAll(swapFrom, `url.protocol = ${protocolSwap};`)
  return out
}

/** Graph row exactly as the registry's graphRow: id + rev-carrying URL + declared fields. */
function graphRow(id, rev, decl) {
  return {
    id,
    // The harness serves bundles under /plugins/, but Capacitor's Cordova
    // compatibility layer deletes webDir/plugins on every sync (cordova.js
    // removePluginFiles). The row URL is opaque to the client module system,
    // so the static app keeps the exact wire format under /bundles/ instead.
    url: `/bundles/${id}/client.js?rev=${rev}`,
    rev,
    ...(decl.inject?.length > 0 ? { inject: decl.inject } : {}),
    ...(decl.immediately === true ? { immediately: true } : {}),
    ...(decl.external?.length > 0 ? { external: decl.external } : {}),
  }
}

/**
 * Replica of packages/host/webserver/src/injections.ts renderIndexInjections:
 * head rows after the opening head tag, body rows after the opening body tag,
 * each group in table order, `<` escaped in JSON values.
 */
function renderIndexInjections(html, rows) {
  const escapeAttr = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  let head = ''
  let body = ''
  for (const row of rows) {
    let markup
    let placement
    switch (row.kind) {
      case 'global': {
        const name = JSON.stringify(row.name).replaceAll('<', '\\u003c')
        const value = row.value === undefined ? 'undefined' : JSON.stringify(row.value).replaceAll('<', '\\u003c')
        markup = `<script>globalThis[${name}] = ${value}</script>`
        placement = 'head'
        break
      }
      case 'script':
        markup = `<script>${row.text}</script>`
        placement = row.placement
        break
      case 'script-src':
        markup = `<script src="${escapeAttr(row.src)}"></script>`
        placement = row.placement
        break
      case 'style':
        markup = `<style>${row.text}</style>`
        placement = 'head'
        break
      case 'html':
        markup = row.html
        placement = row.placement
        break
      default:
        throw new Error(`build-web: unknown injection row ${JSON.stringify(row)}`)
    }
    if (placement === 'head') head += markup
    else body += markup
  }
  let out = html
  if (head !== '') {
    const open = /<head(?:\s[^>]*)?>/i.exec(out)
    out = open === null ? `${head}${out}` : `${out.slice(0, open.index + open[0].length)}${head}${out.slice(open.index + open[0].length)}`
  }
  if (body !== '') {
    const open = /<body(?:\s[^>]*)?>/i.exec(out)
    out = open === null ? `${out}${body}` : `${out.slice(0, open.index + open[0].length)}${body}${out.slice(open.index + open[0].length)}`
  }
  return out
}

// 1. Build the shell frontend.
console.log('build-web: building apps/web (vite)…')
execFileSync('pnpm', ['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'], {
  cwd: repo,
  stdio: 'inherit',
})

// 2. Browser roster: patch insert rows (`- id: …` immediately followed by
//    `name: …`) from EVERY bundle the active web profile composes — the two
//    in-repo layers (base, web-app) plus the profile's extra bundles — in
//    profile order, deduped by name.
async function parseInsertNames(patchFile) {
  const patch = await readFile(patchFile, 'utf8')
  const lines = patch.split('\n')
  const names = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*- id:\s*\S+\s*$/.test(lines[i])) continue
    const nameMatch = /^\s*name:\s*['"]([^'"]+)['"]\s*$/.exec(lines[i + 1] ?? '')
    if (nameMatch !== null) names.push(nameMatch[1])
  }
  return names
}

const patchFiles = [resolve(baseDir, 'cordis.patch.yml'), patchYml]
// Profile bundle stack: package.json `dsh.profile.bundles`, resolved through
// the profile's own node_modules (link:/file: installs land there). Each
// bundle may carry a `dsh.bundle.patch`.
let profileBundleStack = []
let profilePkg
try {
  profilePkg = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
  profileBundleStack = profilePkg.dsh?.profile?.bundles ?? []
} catch {
  console.warn('build-web: no web profile at ' + profileDir + '; composing base + web-app only')
}
for (const bundleName of profileBundleStack) {
  const bundleResolve = resolveSpec(`${bundleName}/package.json`)
  if (bundleResolve === undefined) {
    console.warn(`build-web: profile bundle ${bundleName} unresolvable; skipped`)
    continue
  }
  const bundlePkg = JSON.parse(await readFile(bundleResolve.path, 'utf8'))
  const patchRel = bundlePkg.dsh?.bundle?.patch ?? 'cordis.patch.yml'
  const patchPath = resolve(dirname(bundleResolve.path), patchRel)
  try {
    patchFiles.push(patchPath)
  } catch {
    console.warn(`build-web: profile bundle ${bundleName} has no ${patchRel}; skipped`)
  }
}
const names = []
for (const patchFile of patchFiles) {
  try {
    names.push(...await parseInsertNames(patchFile))
  } catch (error) {
    console.warn(`build-web: cannot parse ${patchFile}: ${String(error)}`)
  }
}

// 3. Compose the graph and gather bundle files.
const rows = []
for (const name of [...new Set(names)]) {
  const pkgResolve = resolveSpec(`${name}/package.json`)
  if (pkgResolve === undefined) continue
  const pkgJson = JSON.parse(await readFile(pkgResolve.path, 'utf8'))
  const decl = pkgJson.dsh?.client
  if (decl === undefined || decl.platform !== 'web') continue
  const clientResolve = resolveSpec(`${name}/client`)
  if (clientResolve === undefined) {
    throw new Error(`build-web: ${name} declares dsh.client but unresolved ./client`)
  }
  const content = await readFile(clientResolve.path)
  rows.push({ name, clientPath: clientResolve.path, content, decl })
}
const entries = orderByModuleGraph(rows.map(({ name, content, decl }) => graphRow(name, shortHash(content), decl)))
const graph = { rev: shortHash(JSON.stringify(entries)), entries }

// 4. Copy dist + bundles into web-dist/ and render the injections.
await rm(outDir, { recursive: true, force: true })
await cp(resolve(webApp, 'dist'), outDir, { recursive: true })
const byId = new Map(rows.map(row => [row.name, row]))
for (const entry of entries) {
  const { clientPath, content } = byId.get(entry.id)
  const dest = join(outDir, 'bundles', entry.id, 'client.js')
  const body = entry.id === 'dsh-better-sidebar'
    ? patchBetterSidebarWsUrls(content, entry.id)
    : content
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, body)
  void clientPath
}
const indexHtml = await readFile(join(outDir, 'index.html'), 'utf8')
await writeFile(join(outDir, 'index.html'), renderIndexInjections(indexHtml, bootInjections(graph)))

// Failsafe: a partial bundle tree must never reach cap sync.
const bundleFiles = (await readdir(join(outDir, 'bundles'), { recursive: true }))
  .filter(name => name.endsWith('client.js'))
if (bundleFiles.length !== entries.length) {
  throw new Error(`build-web: bundle tree incomplete (${String(bundleFiles.length)}/${String(entries.length)} client.js); refusing to publish web-dist`)
}

console.log(`build-web: ${String(entries.length)} client rows composed (rev ${graph.rev}) into ${outDir}`)
console.log(`build-web: next run \`pnpm sync\` to copy web-dist into the iOS project`)