/**
 * 主 dsh dcf 全量启动编排：以 NODE_ENV=development + DSH_BUILD_DEV=1 启动 dev:web
 * （本体注入 + rebuilt 广播），同时为 ../dsh-plugins 下每个接入 dcf 的插件起
 * watch（有 watch script）或做一次注入构建（无 watch script 的插件）。Ctrl+C
 * 统一停止；任一子进程退出则停止全部。目录不存在（非本机开发布局）时降级为纯
 * dev:web。DSH_BUILD_DEV=1 不可省：dev:web 先跑根 `pnpm run build`，scripts/build.ts
 * 把子进程 NODE_ENV 钉为 production，只透 NODE_ENV 会得到零注入产物
 * （docs/developer/dcf-injection.md 坑 8）。
 *
 * 用法：pnpm dev:web:dcf  （= node scripts/dev-dcf.mjs）
 * 可选：DSH_PLUGINS_DIR=<dir> 覆盖插件目录；其余参数原样转发给 dev:web。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// dev:web 在 Node 22 上会崩溃（tsdown watch 的 import-without-cache 与 tsx 的
// load hook 组合问题，Node >= 24 正常）。本机已有 fnm：默认 Node < 24 时自动
// 用 fnm 的 24.x 重启自身（fnm 缺失时如实退出，提示先切 Node 24）。
if (Number(process.versions.node.split('.')[0]) < 24) {
  try {
    execFileSync('fnm', ['exec', '--using=24', 'node', process.argv[1], ...process.argv.slice(2)], {
      stdio: 'inherit',
    })
  } catch {
    console.error('[dev-dcf] default Node is < 24 and fnm is unavailable; run under Node >= 24')
    process.exit(1)
  }
  process.exit(0)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const pluginsDir = process.env.DSH_PLUGINS_DIR ?? resolve(root, '../dsh-plugins')
const children = new Map()

function stopAll(exitCode) {
  for (const child of children.keys()) child.kill('SIGTERM')
  const timer = setTimeout(() => { process.exit(exitCode ?? 1) }, 3000)
  timer.unref()
}

function spawnStage(label, command, args, cwd, env, once = false) {
  const child = spawn(command, [...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  children.set(child, { label })
  child.on('exit', (code) => {
    children.delete(child)
    // 一次性构建（无 watch script 的插件）正常完成不是编排失败。
    if (once) return
    console.error(`[dev-dcf] ${label} exited with ${String(code)}; stopping the rest`)
    stopAll(code ?? 1)
  })
}

/**
 * 插件是否已接入 dcf（任一信号即可，自适应于不同插件形态）：
 * - 构建配置里出现 codeFinderTsdown/codeFinderVite 调用；
 * - package.json 把 @havocrao/dsh-code-finder 列为依赖。
 */
function hasCodeFinder(dir) {
  const configFiles = ['tsdown.config.ts', 'vite.config.ts', 'vite.config.mts', 'vite.config.js']
  const configSignal = configFiles.some((name) => {
    const file = join(dir, name)
    return existsSync(file) && /codeFinder(?:Tsdown|Vite)/u.test(readFileSync(file, 'utf8'))
  })
  if (configSignal) return true
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
    return deps['@havocrao/dsh-code-finder'] !== undefined
  } catch {
    return false
  }
}

const devWebArgs = ['run', 'dev:web', '--poll', ...process.argv.slice(2)]
console.log(`[dev-dcf] starting dev:web (NODE_ENV=development, DSH_BUILD_DEV=1) and dcf-enabled plugins from ${pluginsDir}`)
spawnStage('dev:web', 'pnpm', devWebArgs, root, { NODE_ENV: 'development', DSH_BUILD_DEV: '1' })

if (existsSync(pluginsDir)) {
  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(pluginsDir, entry.name)
    if (!hasCodeFinder(dir)) continue
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    if (typeof manifest.scripts?.watch === 'string') {
      console.log(`[dev-dcf] watching plugin ${entry.name} (NODE_ENV=development)`)
      spawnStage(entry.name, 'pnpm', ['run', 'watch'], dir, { NODE_ENV: 'development' })
    } else {
      console.log(`[dev-dcf] building plugin ${entry.name} once (NODE_ENV=development, no watch script)`)
      spawnStage(entry.name, 'pnpm', ['run', 'build'], dir, { NODE_ENV: 'development' }, true)
    }
  }
}

process.on('SIGINT', () => { console.error('[dev-dcf] SIGINT'); stopAll(130) })
process.on('SIGTERM', () => { console.error('[dev-dcf] SIGTERM'); stopAll(0) })