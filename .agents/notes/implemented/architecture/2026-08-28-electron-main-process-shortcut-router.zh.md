# Agent Note: electron 主进程快捷键路由

Status: implemented

[English](2026-08-28-electron-main-process-shortcut-router.md) | 中文

## 问题

桌面壳（apps/electron）在 `before-input-event` 里拦截 `Cmd+W` 并弹出关闭确认对话框（apps/electron/src/window.ts）。renderer 永远收不到该按键，而且 window.ts 之外没有任何东西能改变这个按键的语义：主进程插件缺少一个「在保持确认对话框为默认行为的同时认领快捷键」的扩展点。想要让 `Cmd+W` 做上下文相关动作（例如存在活动 tab 时关闭它）的特性，只能去改窗口代码本身。

## 决策

`apps/electron/src/shortcuts.ts` 在 electron profile 的宿主上下文上引入了带类型的 `ShortcutRouter` 服务：`desktopShortcuts?` 合并进 Cordis `Context` 接口，`provideDesktopShortcuts` 在树挂载前安装它（apps/electron/src/host.ts），与 dsh-cmdline 提供 `cmdlineArgs` 的方式一致。处理器按快捷键注册，注册返回其 disposer（register 返回 disposer 规则）。`route` 按注册顺序运行该快捷键的处理器并解析为 `'claimed' | 'unclaimed'`：返回 `true` 认领按键，`false`/`undefined` 传递给下一个处理器，Promise 结果按序等待。

window.ts 在关闭确认回退之前把拦截到的 Cmd+W 交给路由：认领则窗口不动，未认领（或处理器抛错）则保持现有确认对话框（[Cmd+W 关闭确认决策](../feature/2026-08-24-electron-close-confirmation.zh.md)）。`routingCloseShortcut` 守卫在路由进行中丢弃重复按键，与既有 `confirmingClose` 守卫对应。当前唯一已知的快捷键是 `'cmd-w'`；`DesktopShortcut` 联合类型是未来新增快捷键的位置。

renderer 路径保持封闭。页面侧消费方需要 preload/IPC 桥——在既有 sandboxed、context-isolated web contents 之上加 contextBridge 与 `webContents.send`——这会扩大安全面且今天没有消费方。该桥将来在路由上注册。

## 备选方案

**用 `sendInputEvent` 把 Cmd+W 重新派发进 renderer，由页面决定。**否决：页面还没有快捷键系统或消费方，关闭确认默认行为将依赖一次缓慢的「页面是否消费了」往返，而且 renderer 契约会在没有属主的情况下改变。

**在 `createWindow` 上加一个普通回调参数。**否决：它只服务 main.ts 里的唯一调用方，对插件不可见；宿主上下文上的服务可被任意 electron-profile 插件发现（`ctx.desktopShortcuts`），并符合 registrations-are-effects 约定。

**移除 Cmd+W 拦截，交给页面 JavaScript。**否决：应用没有自定义菜单，before-input-event 处理器是唯一的关闭快捷键控制——去掉它会让 Cmd+W 在无确认的情况下关闭窗口并结束会话。

## 后果

- 默认行为不变：除非有处理器认领，Cmd+W 仍然先确认再关闭。
- 主进程插件无需触碰 window.ts 即可认领壳快捷键；新的壳快捷键扩展 `DesktopShortcut` 联合类型。
- 页面侧认领仍推迟到带真实消费方的 preload/IPC 桥；路由界定了该桥的注册点。
- 异步处理器会按自身延迟推迟回退对话框；处理器是主进程插件代码，因此延迟受插件约束，与 renderer 无关。