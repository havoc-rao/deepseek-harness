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
- `Cmd+W` 关闭前会请求确认：窗口拦截该快捷键并弹出原生对话框（默认取消），因为关闭会结束正在运行的 host 会话。其他关闭路径（窗口按钮、Windows/Linux 上的 `Ctrl+W`）不拦截。
- 壳快捷键经由 `src/shortcuts.ts` 路由：主进程插件可通过在 `ctx.desktopShortcuts` 上注册处理器认领 `Cmd+W`；未被认领的按键仍走确认对话框。
