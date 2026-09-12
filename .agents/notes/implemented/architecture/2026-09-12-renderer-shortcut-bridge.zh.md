# Agent Note: 渲染进程快捷键桥与标签中键关闭

Status: implemented

[English](2026-09-12-renderer-shortcut-bridge.md) | 中文

## Problem

Cmd+W 在 Electron 主进程中被拦截，渲染进程永远收不到该键（apps/electron/src/window.ts），并经由 `desktopShortcuts` 路由器分发；页面侧消费者没有认领按键的通道——[快捷键路由器 note](2026-08-28-electron-main-process-shortcut-router.zh.md) 记录了渲染进程路径保持关闭，留待它所点名的 preload/IPC 桥。dsh-better-sidebar（v0.20.x）希望 Cmd+W 在右侧栏存在活动标签页时关闭它，否则不认领，让窗口保持关闭确认对话框。另外，dockkit 的标签关闭只有悬停 × 与上下文菜单两条路：在标签芯片上中键点击毫无作用——更糟的是，它会开始一次拖拽。

## Decision

**preload/IPC 桥让页面可以认领壳快捷键。** `apps/electron/src/preload.ts` 在既有 sandboxed、context-isolated web contents 上通过 contextBridge 暴露 `window.dshDesktopShell.onShortcut(name, handler)`，并以 CommonJS 产物发布（`lib/preload.cjs`，tsdown 的第二个 pass；`sandbox: true` 的 preload 只能 `require('electron')`）。主进程为每个窗口注册一个 'cmd-w' 路由器 handler（`apps/electron/src/renderer-shortcuts.ts`）：窗口已销毁或仍在加载时不做询问直接回未认领；否则 handler 向该窗口的 webContents 发送 `dsh:shell-shortcut`（`{ name, requestId }`），等待 preload 的 `dsh:shell-shortcut-claim`（`{ name, requestId, claimed }`）回复，其中 `claimed = handler() === true`。preload 总是回复——无 handler 或 handler 抛异常都回 `false`——且 1.5s 内未收到回复的询问按未认领结算，因此渲染进程死掉也不会挂起窗口关闭。窗口 `closed` 时注销 handler、结算所有在途询问并移除 claim 监听。

桥以 `handler() === true`（路由器的认领语义）作答，未被认领的按键原样保留 `confirmClose`。每个窗口拥有自己的桥；回复按 request id 路由，其他窗口忽略。

**中键点击关闭标签芯片。** 在 ui-dockkit，芯片的 `onPointerDown` 现在对 `button === 1` 与 `button === 2` 一样直接返回（不启动拖拽），芯片在 `onAuxClick` 中对 `button === 1` 作答：`preventDefault`（Chromium 中键自动滚动）、`stopPropagation`（芯片自己报自己的 intent）、并在宿主 `canCloseTab` 允许时调用 `onCloseTab(tab.id)`。浮窗的标题芯片与 header 同样处理（packages/client/ui-dockkit/src/components/TabPanel.tsx、FloatLayer.tsx）。

## Alternatives considered

**让页面收到真实按键。** 不拦截 Cmd+W，或用 `sendInputEvent` 重新分发给页面，把决定权交给一个没有键绑定系统的页面，并让确认对话框依赖慢速往返；快捷键路由器 note 已拒绝此方案。桥保留主进程仲裁，只增加一个布尔回复。

**询问不加超时。** 渲染进程停止响应会挂起每一次窗口关闭。1.5s 期限把按键按未认领结算，即对话框的默认行为。

**不带每窗口状态的全局 claim 通道。** 单一 pending map 无法分辨回复属于哪个窗口；每个窗口拥有自己的桥，回复携带询问的 request id。

**在 pointerdown 上抑制自动滚动。** Chromium 在中键 `mousedown` 时（早于 `auxclick`）启动自动滚动，只有在该按下事件上 `preventDefault` 才能可靠阻止。本实现按消费方契约在点击手势（`auxclick`）上作答；`auxclick` 上的 `preventDefault` 覆盖会参考它的浏览器。

## Consequences

页面获得了壳快捷键的认领通道：dsh-better-sidebar 在 Cmd+W 时关闭右侧栏活动标签页，否则窗口保持确认对话框。渲染进程的输入面在既已 sandboxed、宿主 origin 的页面上多了一个 contextBridge API，主进程每次询问只接受一个布尔认领。页面停止响应时，对话框最多晚出现 1.5s。中键关闭取代了 dockkit 芯片上原属无效（且会启动拖拽）的按下，浮窗标题同样适用，可关闭性仍由宿主的 `canCloseTab` 决定；悬停 × 与上下文菜单保留。apps/desktop-host 子进程模式（`dsh-app://`）是另一部署面，不暴露此桥；apps/electron README 记录了面向 v0.20.x 消费者的契约。