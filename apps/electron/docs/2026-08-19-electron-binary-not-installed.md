# `dsh electron` 报 "electron binary is not installed" 排查与修复

日期:2026-08-19
影响:首次在本机跑 `dsh electron` 即失败。

## 现象

```sh
$ dsh electron
dsh: electron binary is not installed for /Users/havoc420/Documents/Projects/tools/deepseek-harness/apps/electron/
     — run 'pnpm install' (or 'pnpm --filter @deepseek-ai/dsh-electron install') first
```

错误提示建议重跑 `pnpm install`,但实际上光重装无法解决。

## 定位路径

- 报错来自 `apps/cli/src/electron.ts` 的 `startElectron()`,由 `resolveElectronBinary(appDir)` 返回 `undefined` 触发。
- `resolveElectronBinary()` 依次检查:
  1. `findElectronPackageDir()` 沿 `node_modules` 向上找 `electron` 包 — **命中**(`apps/electron/node_modules/electron` → pnpm store `electron@43.4.0`)。
  2. 包内的 `path.txt` — **缺失**。
  3. `dist/<binary>` — **缺失**。

即:electron npm 包本身装好了,但它的**二进制从未下载**,`dist/` 和 `path.txt` 都不存在。

## 根因

`electron` npm 包通过 postinstall(`install.js`)在安装时下载平台二进制到 `dist/` 并写 `path.txt`。

`pnpm-workspace.yaml` 的 `allowBuilds` 白名单(pnpm 11 `strictDepBuilds` 默认拦截一切生命周期脚本)漏了 `electron`:

- 被拦截 → postinstall 从未执行 → 二进制不落盘。
- 所以 `pnpm install` 重装时脚本依旧被跳过,提示里的"修复命令"无效——**必须先把 `electron` 加进白名单**。

## 修复

### 1. `pnpm-workspace.yaml`:批准 electron 的构建脚本

```yaml
allowBuilds:
  ...
  koffi: true
  # The desktop app's postinstall downloads the platform Electron binary into
  # dist/ and writes path.txt; without it `dsh electron` has nothing to launch.
  electron: true
```

改动后 pnpm 立即把 `.modules.yaml` 里的 `"electron": true` 写上了(说明它读到了新白名单)。

### 2. 触发 install 脚本

尝试了两次 pnpm 原生方式,都是**静默无操作**:

- `pnpm rebuild electron` — 无输出、不跑脚本。
- `pnpm rebuild --pending electron` — 同样无输出(pnpm 11.7 对已在 store 中的包,rebuild 不重跑 postinstall 的怪癖)。

实际有效做法:直接手动执行 store 里该包的安装脚本。

```sh
cd node_modules/.pnpm/electron@43.4.0/node_modules/electron
node install.js
```

`install.js` 用 `@electron/get` 下载平台包(`dist/` 里解出 `Electron.app`),并写 `path.txt`(内容 `Electron.app/Contents/MacOS/Electron`)。

### 3. 验证

```sh
$ dsh electron
dsh: electron started (pid 55823); log: /Users/havoc420/.dsh/electron.log
```

- 桌面进程存活(`ps -p 55823` 通过)。
- 启动不阻塞终端(`detached: true`,stdout/stderr 追加进日志文件)。

## 复发与根治（2026-08-20 追加）

**上述"后续注意"不成立,会复发。** 2026-08-20 实测:allowBuilds 已含 electron,但后续一次 `pnpm install`(依赖树变化)重建 store 时,**pnpm 11 对已在 store 的包不重跑 postinstall**,手动补的 `dist/`+`path.txt` 被冲掉,`dsh electron` 重现同一报错。

**根治:`apps/electron` 的 own postinstall 兜底。**

- 新增 `apps/electron/scripts/ensure-electron-binary.mjs`:幂等检查 `node_modules/electron/path.txt` + `dist/`,缺失则在本目录运行 electron 包的 `install.js` 补二进制。
- `apps/electron/package.json` 的 `scripts` 加 `"postinstall": "node scripts/ensure-electron-binary.mjs"`。
- workspace 自己的 postinstall 不受 `allowBuilds` 管控,凡"依赖树真的变了"的那次 install 后都会执行——而这正是二进制会被冲掉的唯一场景。
- 踩坑:`appRoot` 的 `dirname(import.meta.url)` 上溯一次(`'..'`)即可到 `apps/electron`;写两次会指向 `apps/`,existsSync 全 false 静默跳过(exit 0 无日志),调试时毫无提示。

**当前双保险:**
1. pnpm 真正重装 electron 时(版本变化/`--force`),由于 allowBuilds 已批准,由 electron 自己的 postinstall 下载;
2. store 里已有包但二进制缺失时(重建冲掉、手动误删),由 `apps/electron` 的 postinstall hook 补位。

验证:删 `dist`+`path.txt` → `node scripts/ensure-electron-binary.mjs` 自动下载恢复;`pnpm install --force --filter @deepseek-ai/dsh-electron` 后 `path.txt` 仍在;`dsh electron` 正常启动(pid 18538)→ stop。

注意 pnpm 的 no-op install(依赖树完全没变)不会跑任何 lifecycle,此时若二进制被手动删掉,需手动跑一次 hook(`node apps/electron/scripts/ensure-electron-binary.mjs`)或 `pnpm rebuild`。查询状态:`cat node_modules/.pnpm/electron@43.4.0/node_modules/electron/path.txt`。
