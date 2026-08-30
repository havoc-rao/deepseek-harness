# dsh Electron 桌面应用 — 模块说明

**路径**：`apps/electron/`

dsh web client 的桌面 shell，复用共享 `web` profile——即 `dsh web` 运行的同一 host 插件树。renderer 直接加载 host webserver 的 `http://127.0.0.1:<port>`，同源 fetch/WebSocket/模块脚本无需 CORS 或自定义 scheme 桥接。

---

## 源文件

| 文件 | 职责 |
|---|---|
| `src/main.ts` | Electron 入口：`app.whenReady` → `startHost` → `createWindow` |
| `src/host.ts` | host 启动：profile 加载、patch 叠加、loader shim、fail-loud |
| `src/window.ts` | BrowserWindow 创建：沙箱、无 node 集成、导航锁定 host origin、平台窗口边框 |

## 结构

```
┌───────────────────────── main process ─────────────────────────┐
│  shimLoaderInternal() — Electron-safe loader.internal shim      │
│  startHost() — boot the shared 'web' profile                    │
│    webserver: 127.0.0.1:<os-assigned-port>                      │
│    healProfilesModuleFallback → ~/.dsh/profiles/node_modules    │
│  createWindow(host.url)                                         │
│    loadURL(http://127.0.0.1:<port>/)                            │
└─────────────────────────────────────────────────────────────────┘
   renderer: http://127.0.0.1:<port>/（sandboxed，no node）
     same-origin fetch / WebSocket / <script> modules
```

---

## 关键处理

### loader.internal shim（`host.ts`）

Electron 的 embedder 无法加载 `node-addon-require-builtin` addon——它需要仅纯 Node 导出的 `GetAlignedPointerFromEmbedderData` 符号。`shimLoaderInternal()` 在 `ModuleLoader.fromInternal()` 返回 undefined 时替换为基于 `createRequire(base)` 的 shim，使配置树的 bare package name 解析到 profile 目录。

### healed profile modules

`healProfilesModuleFallback` 将 web profile 的依赖树链接到 `~/.dsh/profiles/node_modules`（与 CLI 相同），配置树从该处解析 bare name。

### 安全加固

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- `will-navigate` 锁定导航到 host origin
- `setWindowOpenHandler` 将外部链接交给系统浏览器
- `will-attach-webview` 阻止所有 webview 附加

### 窗口边框

- macOS：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition`（x12/y8），标题栏隐藏、红绿灯保留并贴左上角叠放在 sidebar 预留的顶部条带上方；Windows：`titleBarStyle: 'hidden'` + `titleBarOverlay`（着色与窗口底色一致），保留原生最小化/最大化/关闭按钮；Linux 保留默认边框。
- 隐藏标题栏后窗口拖拽由 web UI 承担：boot 时按 UA 在 `<html>` 打 `data-shell` 标记（`packages/client/web/src/shell-chrome.ts`），AppFrame 顶部 14px 拖拽带与 sidebar 顶部条带（`--dsh-shell-top-inset`，其 `::before` 为拖拽目标）及 logo 行（按钮 `no-drag`）共同构成拖拽区。普通浏览器（`dsh web`）无此标记，样式不生效。

### 桌面壳标记

共享 'web' profile 也会被 `dsh web`（CLI）启动，插件无法从 profile 本身判断宿主。主进程插件树通过 `ctx.desktopShell === true` 观测桌面壳（`apps/electron/src/shell.ts` 的 `provideDesktopShell`，与 `desktopShortcuts` 一样在树挂载前提供）；renderer 侧插件则读 `documentElement.dataset.shell`（`electron-mac` / `electron-win` / `electron-linux`）。

### Host 信任（`isTrustedApiRequest`）

hostname 为 loopback，client 的基于 location 的检查（`isLoopback` 用于 host 支持的设置与路径）行为与浏览器中完全一致。

### 配置

`config/electron.patch.yml`：webserver 固定到 loopback 并使用 OS 分配端口，禁用 web shell 的 URL 行和 surface persona。

---

## 运行命令

```sh
pnpm run electron:dev       # dev: build (tsc + tsdown) then `electron .`
pnpm run electron:build     # build only: emit lib/ artifacts
pnpm run electron:start     # run the built artifacts (`electron .`, no rebuild)
pnpm run cli:web            # alternative: boot the web UI via the built CLI
```

- `electron:dev` 设置 `DSH_ELECTRON_DEV=1`，窗口标题加 `(dev)` 后缀。
- `electron:start` 假定已执行 `electron:build`（或 repo `pnpm run build`）。
- 前提：完整 repo 构建（`pnpm run build`）使 web 前端 dist 和插件 bundle 存在。
- 共享 profile 来自 `dsh web`（`~/.config/dsh/profiles/web`）；用户 patch 编辑在重启时生效——桌面应用刻意跳过 CLI 的配置 HMR。

## Notes

- 尚未打包（electron-builder/forge）；`pnpm run dev` 从源码运行。
