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

## 后续注意

- `allowBuilds` 里已有 `electron: true` 后,换机/重建时常规 `pnpm install` 会自动跑 postinstall,不会再出现本问题。
- 若某环境走了 `--ignore-scripts` / `.npmrc ignore-scripts=true`,则只有 `pnpm rebuild --pending electron` 或手动 `node install.js` 能补。
- 查询当前二进制状态:`cat node_modules/.pnpm/electron@43.4.0/node_modules/electron/path.txt`。