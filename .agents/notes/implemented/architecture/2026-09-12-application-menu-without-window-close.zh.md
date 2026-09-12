# Agent Note: 不带窗口关闭快捷键的应用菜单

Status: implemented

[English](2026-09-12-application-menu-without-window-close.md) | 中文

## Problem

apps/electron 从不安装应用菜单，因此生效的是 Electron 默认菜单：macOS 上它的 File 菜单带有关闭窗口项（Cmd+W，role 'close'）。菜单加速键可能先于 window.ts 所依赖的 webContents before-input-event 触发，因此即使页面已通过[渲染进程快捷键桥](2026-09-12-renderer-shortcut-bridge.zh.md)认领了按键，Cmd+W 仍可能直接关闭窗口。语义 A（dsh-better-sidebar 消费方，v0.20.x）让 Cmd+W 永不打开关闭确认对话框：有活动标签页则关闭它，否则折叠右侧栏或不做任何事——页面始终认领。默认菜单是唯一能绕过该契约的通道；桥本身无法阻止它。

## Decision

main.ts 在 app ready 后调用 `Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate()))`，模板做成可测导出（`apps/electron/src/menu.ts`）且只由 role 构成，因此文案与加速键保持 Electron 的平台本地化版本，不硬编码任何拷贝。macOS 得到 `appMenu`（About / Services / Hide / Quit——Cmd+Q 仍是退出路径）、`editMenu`（剪切 / 复制 / 粘贴，供终端与编辑器输入框使用）、`viewMenu`、`windowMenu` 与一个空的 `help` 菜单；Windows 与 Linux 得到 `fileMenu`（在那边只含 Quit）、`editMenu`、`viewMenu` 与 `windowMenu`。macOS 刻意不用 `fileMenu`：在那里它含有关闭窗口项——正是本模板禁止的项；Windows/Linux 的 `fileMenu` 不含 close role，因此 Ctrl+W 也不可能出现。单测递归遍历模板树，在每一个平台上拒绝任何 role 'close' 项或匹配 CmdOrCtrl+W 的加速键；同时钉住角色集（macOS App 菜单居首、Edit 角色在场、无硬编码文案或加速键）。

关闭确认因此只存在于一条路径：before-input-event → 快捷键路由器未被认领。语义 A 下页面始终认领，对话框只在窗口已销毁、仍在加载、页面沉默或缺少处理器时可达。

## Alternatives considered

**保留默认菜单，改在窗口 'close' 事件上裁决。** 默认关闭窗口项会触发一个窗口可 preventDefault 的 close 事件——但该事件无法区分菜单加速键与红绿灯或窗口按钮，因此每次关闭都需要来源嗅探逻辑，且页面的认领不参与其中。移除该菜单项让菜单在结构上无法关闭窗口，这才是语义 A 需要的防护。

**手写菜单项。** 在不含关闭窗口项的前提下重述 Electron 默认模板能保留完整的编辑控制，但它的文案属于本地化所有；role 菜单免费获得 Electron 本地化的文案与加速键。

**只在 macOS 之外保留默认菜单。** 同样的程序级不变量（绝不从菜单加速键关闭）在每个平台都适用且成本相同；按平台拆分只会成倍增加测试面，毫无收益。

## Consequences

菜单在任何平台都无法关闭窗口：模板全树（macOS 与 Windows/Linux）都没有关闭窗口项，也没有 Cmd+W / Ctrl+W 加速键。Cmd+Q 是菜单的退出路径（macOS App 菜单；Windows/Linux 上的 File > Quit），红绿灯 / 窗口按钮仍如既往关闭窗口——那条路径从未被拦截，依然是无需 Cmd+Q 结束应用的途径。Edit 角色保留剪切 / 复制 / 粘贴，供终端与编辑器输入框使用。渲染进程快捷键桥 note 无需更正（它从未提及菜单），apps/electron README 现在写明确认对话框只通过未被认领的路由路径可达，消费方 dsh-better-sidebar 按语义 A 认领。