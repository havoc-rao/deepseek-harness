# dsh Electron 桌面应用

[English](README.md) | 中文

dsh web client 的桌面 shell。它复用共享的 `web` profile——即 `dsh web` 运行的同一 host 插件树。renderer 直接加载 host webserver 的 `http://127.0.0.1:<port>`，因此同源 `fetch`、WebSocket 下行链路和模块脚本均可在无 CORS 或自定义 scheme 桥接的情况下工作。

## Architecture

```
┌───────────────────────── main process ─────────────────────────┐
│  shimLoaderInternal() — Electron-safe loader.internal shim      │
│  startHost() — boot the shared 'web' profile                    │
│    webserver: 127.0.0.1:<os-assigned-port>                      │
│    healProfilesModuleFallback → ~/.dsh/profiles/node_modules    │
│  createWindow(host.url)                                         │
│    loadURL(http://127.0.0.1:<port>/)                            │
└─────────────────────────────────────────────────────────────────┘
   renderer: http://127.0.0.1:<port>/ (sandboxed, no node)
     same-origin fetch / WebSocket / <script> modules
```

两个 main-process 特殊处理说明：

- **`loader.internal` shim**：暴露 Node 内部模块加载器的 `node-addon-require-builtin` addon 无法在 Electron 的 embedder 内加载（它需要一个仅纯 Node 导出的 `GetAlignedPointerFromEmbedderData` 符号）。`host.ts` 替换为基于 `createRequire(base)` 的 shim，使配置树的 bare package name 解析到 profile 目录。
- **Healed profile modules**：`healProfilesModuleFallback` 将 web profile 的依赖树链接到 `~/.dsh/profiles/node_modules`（与 CLI 相同），配置树从该处解析 bare name。

hostname 为 loopback，因此 client 的基于 location 的检查（`isLoopback` 用于 host 支持的设置和路径打开）行为与浏览器中完全一致。`config/electron.patch.yml` 将 webserver 固定到 loopback 并使用 OS 分配端口，禁用 web shell 的 URL 行和 surface persona。

## Run

从 repo 根目录（或本包内）：

```sh
pnpm run electron:dev       # dev: build (tsc + tsdown) then `electron .`
pnpm run electron:build     # build only: emit lib/ artifacts
pnpm run electron:start     # run the built artifacts (`electron .`, no rebuild)
pnpm run cli:web            # alternative: boot the web UI via the built CLI
```

`electron:start` 假定已执行 `electron:build`（或 repo `pnpm run build`）。`electron:dev` 设置 `DSH_ELECTRON_DEV=1`，在窗口标题添加 `(dev)` 后缀；`electron:start` 不设置。
前提条件：已执行完整 repo 构建（`pnpm run build`），使 web 前端 dist 和插件 bundle 存在。共享 profile 来自 `dsh web`（`~/.dsh/profiles/web`）；用户 patch 编辑在重新启动时生效——桌面应用刻意跳过 CLI 的 config HMR。

## 打包为 macOS 应用

`pnpm run pack` 构建 `dist/release/dsh.app`——一个自包含的 `.app`，可直接拖入 `/Applications`（ad-hoc 签名，本地可打开；拷贝后右键 → 打开可绕过 Gatekeeper）。`pnpm run pack:dmg` 还会通过系统 `hdiutil` 产出 `dist/release/dsh-<version>.dmg`。

打包流水线（`scripts/pack-dist.mjs`）刻意不需要 electron-builder 或 forge：它把 workspace 依赖闭包 `pnpm deploy` 到 `dist/pack`，挂载到 `Contents/Resources/app/`，将拷贝来的 Electron 运行时 `Info.plist` 改指 `dsh` 身份，把主程序改名为 `dsh`，并换上应用图标。`asar` 有意不用——桌面宿主通过真实路径解析其插件闭包，且 `healProfilesModuleFallback` 会把包 symlink 到 `~/.dsh`。

前提：已构建 `lib/` 产物（`pnpm run build`）且 workspace 已安装（`pnpm install`）。已存在的 `dist/` 会中止打包（只产出全新产物）；重建前需手动删除。

要分发给他人，请用 Developer ID 对产物签名并公证（`codesign --deep --options runtime --entitlements ...` 后 `notarytool submit`）——流水线默认不签名。

## Notes

- `pnpm run dev` 从源码运行；打包是分发路径。
- `Cmd+W` 永不关闭窗口：窗口在 before-input-event 中拦截并将其交由快捷键路由器分发，关闭确认对话框只存在于未被认领的路径（窗口已销毁、仍在加载、页面沉默或没有任何处理器）。应用菜单（`src/menu.ts`）被显式设置且不含任何 Close Window 项——全菜单无 Cmd+W / Ctrl+W 加速键——因此菜单无法绕过该路径。关闭应用走 `Cmd+Q`（macOS App 菜单）、窗口按钮或标题栏控件。dsh-better-sidebar 消费方（v0.20.x）按语义 A 始终认领：有关闭活动标签页，否则折叠右侧栏或不操作。
- 壳快捷键经由 `src/shortcuts.ts` 路由：主进程插件可通过在 `ctx.desktopShortcuts` 上注册处理器认领 `Cmd+W`；未被认领的按键仍走确认对话框。
- `Cmd+=` / `Cmd+-` / `Cmd+0`（Windows 与 Linux 上为 Ctrl）缩放整个窗口。壳在 before-input-event 中用基于 key code 的匹配（`=`、`-`、`0`）拦截这些组合键，因为 View 菜单内置的放大加速键是 `CommandOrControl+Plus`，macOS 上直接按 `=` 不会命中。步进与菜单角色一致，并钳制在合理区间；菜单角色仍保留，供点击使用。
- 隐藏标题栏保持可拖拽：preload 打上 `<html data-platform="darwin">`（Windows 为 `data-windows-titlebar` 与 `--dsh-windows-titlebar-height`），从而启用共享客户端的 `data-window-drag` chrome 行——侧边栏顶部条与 logo 行、对话 header、dockkit 标签条及入口页头部——与产品桌面壳的契约完全一致。macOS 窗口还叠加 sidebar 毛玻璃材质，让透明页面透出原生材质。
- 页面可通过 preload 桥 `window.dshDesktopShell.onShortcut(name, handler)` 认领快捷键（见 `src/preload.ts`）：主进程以 `dsh:shell-shortcut` 询问，handler 返回 `true` 即认领；页面始终不回复（1.5s 超时）则保持确认对话框。每个 name 只保留一个 handler——后注册覆盖先注册——返回的 disposer 只删除自己的注册。消费方是 dsh-better-sidebar 插件（v0.20.x）；apps/desktop-host 子进程模式（`dsh-app://`）是另一部署面，不暴露此桥。
