/**
 * `pnpm run dev:desktop:dcf`：desktop 的 dcf 全量启动编排。
 *
 * 能力与 dev:web:dcf 对等，面向 @package.json dev:desktop:home（Electron 壳 dev）：
 * - 接线（幂等，崩溃恢复 sanitizeProfile 清掉第三方 bundle 后重跑即可恢复）：
 *   1. desktop profile（~/.dsh/profiles/desktop）node_modules 装 dcf 包（symlink，
 *      与 web profile 同款 link: 惯例；DSH_HOME 可用环境变量覆盖）；
 *   2. profile cordis.patch.yml 注入 `dsh-code-finder-mount` insert 行（已存在则跳过）。
 * - 启动：以 NODE_ENV=development + DSH_BUILD_DEV=1 透传启动 dev:desktop:home——
 *   dev.ts 的根 build（client bundles + dsh-web-frontend/dist）因此产注入产物，
 *   Host 子进程以 dev 语义启动（cordis 守卫放行 → overlay + /code-finder/api 路由
 *   可用）。DSH_BUILD_DEV=1 不可省：scripts/build.ts 把子进程 NODE_ENV 钉为
 *   production，只透 NODE_ENV 会得到零注入产物（docs/developer/dcf-injection.md 坑 8）。
 *
 * 前置：dcf 仓库（DSH-code-finder）需已 `pnpm build` 产出 lib/（link: 依赖指向它）。
 *
 * 用法：
 *   pnpm run dev:desktop:dcf              # 接线 + 启动（前台，Ctrl+C 退出）
 *   pnpm run dev:desktop:dcf -- --ensure-only   # 只接线不启动
 * 可选 env：DSH_HOME=<dir>（默认 ~/.dsh）、DCF_DIR=<dcf 仓库>（默认 tools/DSH-code-finder）
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'desktop')
const DCF_DIR = resolve(process.env.DCF_DIR ?? '/Users/havoc/Documents/Projects/tools/DSH-code-finder')
const PATCH_FILE = join(PROFILE_DIR, 'cordis.patch.yml')
const MOUNT_ID = 'dsh-code-finder-mount'
const MOUNT_BLOCK = [
  '# dsh-code-finder (dcf) 注入定位插件挂载行（dev:desktop:dcf 自动接线，可安全重复执行）',
  '- insert:',
  `    - id: ${MOUNT_ID}`,
  "      name: '@havocrao/dsh-code-finder'",
  '      config:',
  '        roots:',
  `          - ${REPO_ROOT}`,
]

const fail = (message) => {
  console.error(`[dev-desktop-dcf] ✗ ${message}`)
  process.exit(1)
}

/** ① dcf 仓库产物检查（link: 依赖直接指向仓库 lib/）。 */
function ensureDcfBuilt() {
  const entry = join(DCF_DIR, 'lib', 'tsdown.js')
  if (existsSync(entry)) {
    console.log(`[dev-desktop-dcf] ✓ dcf 产物在（${relative(REPO_ROOT, entry)}）`)
    return
  }
  fail(`dcf 仓库产物缺失：${DCF_DIR}/lib。先执行：cd ${DCF_DIR} && pnpm install && pnpm build`)
}

/** ② profile 依赖接线：node_modules/@havocrao/dsh-code-finder → DCF_DIR（幂等）。 */
function ensureProfileLink() {
  const scopeDir = join(PROFILE_DIR, 'node_modules', '@havocrao')
  const link = join(scopeDir, 'dsh-code-finder')
  if (!existsSync(PROFILE_DIR)) fail(`desktop profile 不存在：${PROFILE_DIR}`)
  mkdirSync(scopeDir, { recursive: true })
  let current = null
  try {
    current = readFileSync(link, 'utf8') // 文件 → 非 symlink
  } catch {
    try {
      const linkTarget = readlinkSync(link) // symlink → 目标
      // 绝对目标直接用（path.join 对绝对右参不重置，直接 join 会错拼）
      current = isAbsolute(linkTarget) ? resolve(linkTarget) : resolve(join(dirname(link), linkTarget))
    } catch {
      current = null // 不存在
    }
  }
  if (current === resolve(DCF_DIR)) {
    console.log(`[dev-desktop-dcf] ✓ profile 链接已在（${relative(PROFILE_DIR, link)}）`)
    return
  }
  try {
    unlinkSync(link)
  } catch {
    /* 不存在则跳过 */
  }
  symlinkSync(DCF_DIR, link, 'dir')
  console.log(`[dev-desktop-dcf] ✓ 已接线：${relative(PROFILE_DIR, link)} → ${DCF_DIR}`)
}

/** ③ patch 挂载行（幂等：已有 dsh-code-finder-mount 则跳过）。 */
function ensurePatchMount() {
  if (!existsSync(PATCH_FILE)) fail(`profile patch 不存在：${PATCH_FILE}`)
  const patch = readFileSync(PATCH_FILE, 'utf8')
  if (patch.includes(`id: ${MOUNT_ID}`)) {
    console.log(`[dev-desktop-dcf] ✓ patch 挂载行已在（${relative(DSH_HOME, PATCH_FILE)}）`)
    return
  }
  const block = `${MOUNT_BLOCK.join('\n')}\n\n`
  const existing = patch.replace(/^---\n/u, '') // 去可选文档头，块前置
  writeFileSync(PATCH_FILE, `${'---\n'}${block}${existing}`)
  console.log(`[dev-desktop-dcf] ✓ 已写入挂载行：${relative(DSH_HOME, PATCH_FILE)}`)
}

const args = process.argv.slice(2)
if (args.includes('--ensure-only')) {
  ensureDcfBuilt()
  ensureProfileLink()
  ensurePatchMount()
  console.log('[dev-desktop-dcf] 接线完成（未启动）。运行 pnpm run dev:desktop:dcf 启动。')
  process.exit(0)
}

ensureDcfBuilt()
ensureProfileLink()
ensurePatchMount()

const desktopArgs = ['run', 'dev:desktop:home', ...(args.length > 0 ? ['--', ...args] : [])]
console.log(`[dev-desktop-dcf] starting dev:desktop:home (NODE_ENV=development, DSH_BUILD_DEV=1, DSH_HOME=${DSH_HOME})`)
const result = spawnSync('pnpm', desktopArgs, {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development', DSH_BUILD_DEV: '1' },
})
if (result.error !== undefined) fail(String(result.error))
process.exit(result.status ?? 1)