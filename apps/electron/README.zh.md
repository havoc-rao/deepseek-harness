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

## Notes

- 尚无打包（electron-builder/forge）；`pnpm run dev` 从源码运行。
