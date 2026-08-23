# Agent Note: 终端渲染器——WebGL 加速、GPU 恢复与主题联动

Status: implemented
Archived: 2026-08-23

[English](2026-08-14-terminal-renderer-webgl-theme.md) | 中文

## Problem

浏览器交互终端面板初始使用 xterm 默认 DOM 渲染器，该渲染器受 CPU 限制且大输出下闪烁。面板还需跟随设计系统主题（浅/深）且无白闪，系统字体栈不得导致 FOUT（未样式化文本闪烁）。这些是 PTY socket 桥接之上的渲染层问题——不改变帧协议或 host 桥接。

## Decision

### WebGL 带边界恢复预算

渲染器从 `WebglAddon`（硬件加速）启动。GPU context 丢失可在 VRAM 压力下反复发生；无限重试循环会空耗 CPU。`WEBGL_RECOVERY_BUDGET = 3` 计数器在每次 `onContextLoss` 时重建 WebglAddon，最多 3 次；第 4 次回退到 `CanvasAddon`。若 WebGL 完全不可用（无头、无 GPU），初始 `loadAddon` 抛错并立即回退到 Canvas。

渲染器 addon 生命周期与创建 xterm 实例的 `useEffect` 同处，而非单独的 `[terminal]` effect，以便 teardown 能在 `Terminal.dispose` 再次运行 AddonManager 之前释放渲染器——仍活跃的 WebGL addon 会在 teardown 中途崩溃（在半释放的渲染器上读取 `_isDisposed`）。

### 防闪烁：resize 后 `_renderRows`

`FitAddon.fit()` 改变终端几何后，WebGL/Canvas 渲染器可能保留一帧旧画面。5.5.x 私有 API `_core._renderService._renderRows(0, rows - 1)` 绕过渲染去抖器并强制立即全量重绘。`TerminalView.tsx` 的 `forceRender` 辅助函数和 `useTerminalLayout.ts` 的内联调用均通过可选链访问 `_core._renderService`，故未来 xterm 版本移除该私有 API 时优雅降级（无强制渲染但不崩溃）。方法名和路径为 xterm 5.5.x 内部 API；升级 xterm 需回归本模块并 patch 测试。

### WebglAddon dispose 垫片

addon-webgl 0.19.0 的 dispose 清理读取 `_core._store._isDisposed`（xterm 6 私有字段）并在字段缺失时抛错——卸载 WebGL 终端会崩溃 `shell.overlay` slot 条目并隐藏切换按钮。`patchWebglDisposeShim` 在字段缺失时植入一个已释放哨兵（`_store = { _isDisposed: true, dispose() {} }`），使清理短路。xterm 6 上该字段已存在，保持不变。

### 主题联动：经 inject face `hooks` 仓室

终端需要在 React 组件中响应式获取已解析主题快照，但 `ctx.theme` 是 cordis 服务，不可从 React 直接访问。方案参照 `hostDescription` 模式：`theme-source.ts` 从 `ctx.theme.getTheme()`（快照）+ `ctx.on('theme/change')`（订阅）创建 `HostObservable<ThemeSnapshot>`；插件主体通过 `shell.overlay` 注册的 `inject: () => ({ hooks: { theme: themeSource } })` 仓室传入；slot 渲染器在 `TerminalPane` 上合成 `useTheme` 选择器 hook；`TerminalPane` 选择 `snapshot.revision`（单调计数器）并作为 `themeRevision` 传给 `TerminalView`；`TerminalView` 的 `useLayoutEffect`（绘制前运行）从 `document.body` 计算样式读取已解析 CSS 变量并写入 `term.options.theme`，然后调用 `forceRender`。

无白闪：`useLayoutEffect` 在 DOM commit 后、浏览器绘制前同步运行。`ThemePresenter`（ui-layout）在其 `theme/change` 监听器中同步将 alias token 写入 `body`——而 ui-layout 是 ui-terminal 的加载顺序前置——故终端读取计算样式时 DOM 已更新。xterm 画布在页面切换的同帧采用新调色板。

### 颜色映射：CSS 变量，非硬编码值

`terminal-theme.ts` 从 `document.body` 读取计算 CSS 自定义属性：主题相关 alias token（`background` ← `--dsw-alias-bg-base`，`foreground`/`cursor` ← `--dsw-alias-label-primary`，`selectionBackground` ← `--dsw-interactive-bg-hover`）和主题无关 static token（ANSI 16 色调色板 ← `--dsw-static-*`）。浅色和深色基础调色板定义相同的 `--dsw-static-*` 值，故 ANSI 颜色跨主题切换稳定——仅 alias 层跟随当前方案。`FALLBACK_THEME`（深色默认值）覆盖样式表未加载的情况（jsdom 测试）。

### 系统字体栈，无 woff2

`fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace'`——仅系统字体，不导入 woff2。无 FOUT，因为字体在首帧绘制时即可用。

## Alternatives considered

**保留 DOM 渲染器。** 拒绝：DOM 渲染器受 CPU 限制，每行输出都会重排整个视口；大型 `ls` 或 `cat` 输出导致可见卡顿。WebGL 将文本光栅化卸载到 GPU，是 xterm 推荐的交互用渲染器。

**无限 WebGL 恢复。** 拒绝：GPU context 丢失可在持续 VRAM 压力下反复发生，无限重试循环在用户可能已切到后台的终端上空耗 CPU。3 次预算保持终端可用且无无限重载循环。

**硬编码 xterm 主题调色板。** 拒绝：硬编码色值会在调色板变更时与设计系统漂移。读取计算 CSS 变量让终端自动保持同步。

**导入打包的 woff2 字体。** 拒绝：Web 字体导致首帧 FOUT。系统等宽字体栈立即可用且避免外部资源依赖。

## Consequences

- 终端渲染器在正常条件下硬件加速，GPU 丢失或不可用时优雅降级到 Canvas。
- xterm 5.5.x 私有 API 依赖（`_renderRows`、`_store`、`scrollToBottom`）使 xterm 或 addon-webgl 升级成为刻意回归点，而非即插即用。
- 终端调色板自动跟踪设计系统；主题切换无白闪地重投影颜色。
- WebglAddon dispose 垫片是临时的，xterm 与 addon-webgl 版本对齐后应移除。
