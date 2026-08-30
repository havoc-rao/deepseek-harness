# Agent Note: Electron 桌面窗口边框（隐藏标题栏 + web 拖拽带）

Status: implemented

[English](2026-08-28-electron-hidden-title-bar.md) | 中文

## 问题

桌面壳（`apps/electron`）用默认 OS 边框创建窗口，于是 UI 在三栏应用框架之上又多了一条常规标题栏（里面只有页面标题）。渲染面自身就从顶部边缘开始，OS 标题栏成了冗余的横条，视觉上把顶边加厚了一倍；macOS 上红绿灯还停在 Electron 默认位置，与 sidebar 的 logo 行毫无对齐。

## 决策

`apps/electron/src/window.ts` 按平台切换窗口边框。macOS 用 `titleBarStyle: 'hiddenInset'` 并显式设置 `trafficLightPosition`（`{ x: 12, y: 8 }`），把红绿灯钉进窗口自身的最上一行、贴住左上角（红绿灯保留——原生关闭/最小化/缩放控件与系统双击缩放照常可用）。Windows 用 `titleBarStyle: 'hidden'` 加 `titleBarOverlay`，着色与窗口底色一致（`#0b0d10`），原生最小化/最大化/关闭按钮悬在一条融合的条带上。Linux 保留默认边框。

renderer 是同一套共享 web 客户端，经 loopback HTTP 提供、没有 preload 桥接，所以由 web 层自行检测壳：boot 内核（`packages/client/web/src/shell-chrome.ts`）解析 `navigator.userAgent`（Electron 会附上版本号），在 UI 挂载前把 `documentElement.dataset.shell` 标记为 `electron-mac` / `electron-win` / `electron-linux`。CSS 只在标记存在时生效：

- `ui-layout` 的 AppFrame 渲染一条 14px 顶部拖拽带，平时惰性（`pointer-events: none`），标记存在时成为窗口顶部拖拽目标（`-webkit-app-region: drag`）。14px 恰好让开 sidebar 第一排可交互控件（按钮从 y=14 开始）。
- `ui-sidebar` 在 macOS 下预留一条顶部条带（`--dsh-shell-top-inset: 20px`，宽态与 rail 态都并入根 padding）：brand 行叠放到红绿灯下方而非横向让位，列保留完整的左边缘。`::before` 拖拽目标填满该条带（`-webkit-app-region: drag`），尺寸等于它所顶替的 padding；logo 行仍向下延伸拖拽目标，brand 与折叠按钮标 `no-drag`，保持可点击。

普通浏览器（`dsh web`）永远不带标记，也不理会 `-webkit-app-region`，看不到任何变化。

## 备选方案

**全平台无边框（`frame: false`）+ web UI 自绘窗口控件。**否决：web 客户端要自己绘制、定位最小化/最大化/关闭，自己处理拖拽与双击缩放，之后每次布局改动都要再与这套控件纠缠；按平台保留原生控件既少代码，也是平台惯例的观感。

**主进程 `insertCSS` 注入拖拽区。**否决：UI 由 CSS Modules 构建、类名已哈希，主进程会伸进 renderer 内部；shell 标记把知识留在拥有布局的 web 层。

**preload/IPC 桥接来标记壳。**否决：目前没有 preload，而 UA 嗅探对这个信号足够可靠（除非刻意禁用，Electron 总会附上版本号）；标记零新增接线。

## 后果

窗口顶边成为 web UI 自己的边框：顶部 14px、sidebar 预留条带与 logo 行间隙均可拖窗，双击拖拽区触发 macOS 缩放动作，红绿灯在系统绘制处照常工作。Windows 保留原生窗口按钮（悬于着色条带上）；Linux 与普通浏览器不变。页面标题仍经 `page-title-updated` 传播，供 Mission Control 与 dock 提示使用。拖拽带刻意做薄，sidebar 条带高度与红绿灯相称，因此没有任何可交互控件丢失命中区域。检测与标记由 `packages/client/web/tests/shell-chrome.client.spec.ts` 单元覆盖；窗口构造由 electron 包构建验证。