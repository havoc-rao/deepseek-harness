# Agent Note: `dsh electron` 启动模式

Status: implemented

[English](2026-08-17-dsh-electron-launcher.md) | 中文

## 问题

`dsh web` 在普通 Node 进程中启动共享的 `web` profile 并打开浏览器，而 Electron 桌面应用（`apps/electron`）此前没有专属的 CLI 启动器——只有 monorepo 的 `pnpm --filter @deepseek-ai/dsh-electron run dev|start`。桌面用户要么离开 `dsh` 界面，要么记住 pnpm 调用。

桌面主进程无法从普通 Node 启动：`apps/electron/src/main.ts` 从 `electron` 包导入 `app`/`BrowserWindow`，而该包在普通 Node 下只导出二进制路径字符串；`host.ts` 还需要 `shimLoaderInternal()`，因为嵌入者无法加载 node addon。因此桌面界面永远不可能通过 `--profile` 启动；正确的形态是解析 Electron 二进制并拉起应用进程的启动器模式。

## 决策

**在 CLI（`apps/cli`）中新增 `dsh electron` 启动器命令族**，与 `dsh web` 并列，以 pid 驱动的 start/stop/log 生命周期取代前台等待：

- `src/electron.ts` — `resolveElectronBinary(appDir)` 通过读取桌面包所装 `electron` devDependency 的 `path.txt` 解析二进制（对 pnpm store 布局与 hoisted node_modules 都正确）。`startElectron(args)` 以桌面应用目录作为 app 路径 detached spawn 二进制，把 pid 记录到 `$DSH_HOME/electron.pid`，把 stdout/stderr 追加到 `$DSH_HOME/electron.log`，unref 后立即返回——已有实例存活时 fail loud，而不是叠出第二个窗口。`stopElectron()` 读取 pid，先发 `SIGTERM`，3 秒宽限期（测试可注入）后升级为 `SIGKILL`，再移除 pid 文件；过期 pid 会被静默清理。`tailElectronLog(lines)` 运行 POSIX `tail -f`，在非 POSIX 系统上明确报告缺少该工具。
- `src/args.ts` — `electron` 子命令把首个 token 解析为动作（`start` 为默认并被省略；`stop`；`log` 支持 `-n/--lines`），像兄弟子命令一样拒绝父级选项（`--profile x electron` 报错），并且 `-h/--help` 打印自己的帮助而不是透传。
- `src/bin.ts` — 新增 `'electron'` 分支，动态 import 运行器，使不相关的模式不进入分发路径。

启动器只在仓库布局内解析应用（`apps/cli/src` 或 `apps/cli/lib` 出发的 `../../electron/` 解析到 `apps/electron`）；桌面应用通过自己的 `startHost()` 及其 `config/electron.patch.yml` 覆盖层启动共享的 `web` profile。因此浏览器与桌面界面共享同一个请求到的插件树，`dsh electron` 只是 electron 包 CLI 之上的一层薄门面（对 `ELECTRON_OVERRIDE_DIST_PATH` 与 pnpm store 布局同样生效）。

## 实现说明

- CLI 保持启动器角色，不做第二次 profile 启动：它从不组合 profile、不应用用户层或 home 层、也不监视 patch 文件。这些全部保留在桌面主进程内，它是 `apps/cli/src/profile-boot.ts` 的镜像。
- pid/log 状态文件放在解析出的 `$DSH_HOME` 下（与 profiles 同一根），名为 `electron.pid` 与 `electron.log`；测试可通过 `baseDir` 注入两者。
- `resolveElectronBinary` 从 app 目录向上遍历 `node_modules` 并读取 electron 包已安装的 `path.txt`；它刻意从不查询 `NODE_PATH`/模块注册表全局，因此裸 app 目录永远不会解析到无关的 electron。单元测试以同样的布局（`package.json` + `index.js` + `path.txt` + `dist/<binary>`）搭出 fake 二进制与 app 目录，从而在不启动真实 Electron 的情况下覆盖 spawn、信号与 pid 文件路径。SIGKILL 升级测试会先让 fake 完成启动（它的 argv marker 落盘）再发信号，确保 fake 自己的 SIGTERM 陷阱已安装。
- 早期迭代的旧构建产物（`lib/types/electron-launch.*`）会过时：构建是 `tsc -b` + `tsdown`（`clean: false`），所以改名的模块会留下一个不再被引用的 chunk，直到完整 clean 构建。

## 备选方案

**复用 `dsh web`。**否决：`apps/electron/main.ts` 需要 Electron API 与窗口生命周期，普通 Node 无法提供；桌面宿主还需要 Electron 专属的 loader shim。

**在 CLI 进程内启动桌面宿主。**否决：那只是名义上不一样的 `--profile` 启动，无法创建操作系统窗口。

## 影响

桌面界面获得了真正的 `dsh electron` 入口：确定性的二进制解析、pid 文件驱动的生命周期、信号升级，以及与启动器一致的 fail-loud 行为。单元测试固定了 argv 布局（app 目录在前，随后是转发参数）、pid 文件生命周期、SIGTERM 到 SIGKILL 的升级（fake 的陷阱在 SIGTERM 后依然存活）、过期 pid 清理、log 前置条件与两条失败路径（`desktop app not found` / `electron binary is not installed`）。`apps/cli/README`、`apps/cli/reference/README` 与帮助文本均记录了这些模式；在 `@deepseek-ai/dsh-electron` 仍为私有未发布包时，它仅限仓库内使用。