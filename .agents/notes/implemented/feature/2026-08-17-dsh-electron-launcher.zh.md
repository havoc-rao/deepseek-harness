# Agent Note: `dsh electron` 启动模式

Status: implemented

[English](2026-08-17-dsh-electron-launcher.md) | 中文

## 问题

`dsh web` 在普通 Node 进程中启动共享的 `web` profile 并打开浏览器，而 Electron 桌面应用（`apps/electron`）此前没有专属的 CLI 启动器——只有 monorepo 的 `pnpm --filter @deepseek-ai/dsh-electron run dev|start`。桌面用户要么离开 `dsh` 界面，要么记住 pnpm 调用。

桌面主进程无法从普通 Node 启动：`apps/electron/src/main.ts` 从 `electron` 包导入 `app`/`BrowserWindow`，而该包在普通 Node 下只导出二进制路径字符串；`host.ts` 还需要 `shimLoaderInternal()`，因为嵌入者无法加载 node addon。因此桌面界面永远不可能通过 `--profile` 启动；正确的形态是解析 Electron 二进制并拉起应用进程的启动器模式。

## 决策

**在 CLI（`apps/cli`）中新增 `dsh electron`，作为纯 spawn 启动器模式**，与 `dsh web` 并列：

- `src/electron-launch.ts` — `resolveElectronBinary(appDir)` 通过读取桌面包所装 `electron` devDependency 的 `path.txt` 解析二进制（对 pnpm store 布局与 hoisted node_modules 都正确），`runElectron(args)` 以桌面应用目录作为 app 路径 spawn 二进制，转发 `SIGINT`/`SIGTERM`，等待子进程结束并返回其退出码（任何启动失败返回 1，并输出 fail-loud 消息）。
- `src/args.ts` — 新增 `electron` 子命令，带原样透传的 `[args...]` 槽位，并与其他兄弟子命令一样拒绝父级选项（`--profile x electron` 报错）。
- `src/bin.ts` — 新增 `'electron'` 分支，动态 import 运行器，使不相关的模式不进入分发路径。

启动器只在仓库布局内解析应用（`apps/cli/src` 或 `apps/cli/lib` 出发的 `../../electron/` 解析到 `apps/electron`）；桌面应用通过自己的 `startHost()` 及其 `config/electron.patch.yml` 覆盖层启动共享的 `web` profile。因此浏览器与桌面界面共享同一个请求到的插件树，`dsh electron` 只是 electron 包 CLI 之上的一层薄门面（对 `ELECTRON_OVERRIDE_DIST_PATH` 与 pnpm store 布局同样生效）。

## 实现说明

- CLI 保持启动器角色，不做第二次 profile 启动：它从不组合 profile、不应用用户层或 home 层、也不监视 patch 文件。这些全部保留在桌面主进程内，它是 `apps/cli/src/profile-boot.ts` 的镜像。
- `resolveElectronBinary` 读取 electron 包已安装的 `path.txt`；单元测试以同样的布局（`package.json` + `index.js` + `path.txt` + `dist/<binary>`）搭出 fake 二进制与 app 目录，从而在不启动真实 Electron 的情况下覆盖 spawn 路径。

## 备选方案

**复用 `dsh web`。**否决：`apps/electron/main.ts` 需要 Electron API 与窗口生命周期，普通 Node 无法提供；桌面宿主还需要 Electron 专属的 loader shim。

**在 CLI 进程内启动桌面宿主。**否决：那只是名义上不一样的 `--profile` 启动，无法创建操作系统窗口。

## 影响

桌面界面获得了真正的 `dsh electron` 入口：确定性的二进制解析、退出码传播、信号转发，以及与启动器一致的 fail-loud 行为。单元测试固定了 argv 布局（app 目录在前，随后是转发参数）、退出码传播与两条失败路径（`desktop app not found` / `electron binary is not installed`）。`apps/cli/README`、`apps/cli/reference/README` 与帮助文本均记录了该模式；在 `@deepseek-ai/dsh-electron` 仍为私有未发布包时，它仅限仓库内使用。