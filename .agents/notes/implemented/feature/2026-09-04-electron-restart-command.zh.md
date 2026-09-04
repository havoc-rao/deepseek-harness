# Agent Note: `dsh electron restart` 从任意记录状态重新拉起桌面应用

Status: implemented

[English](2026-09-04-electron-restart-command.md) | 中文

## 问题

`dsh electron` 既能启动也能停止桌面应用，但没有一条命令能重启它。组合 `dsh electron stop` + `dsh electron start` 恰恰在最需要重启的场景失败：pid 文件缺失时 `stop` 报错（"nothing to stop"），实例存活时 `start` 拒绝（"already running"），而且没有任何环节在下次 spawn 前等旧进程退出。崩溃之后（陈旧 pid）、首次启动（无 pid 文件）或实例健康时，两条命令的配方要么报错，要么需要人工协调。在调用 CLI 进程内部执行重启还会依赖该进程在停止之后仍然存活：旧实例一旦被终止，调用会话的收尾（终端关闭、会话回收）可能先丢弃 CLI，使它到不了启动那一步，应用就此死掉且无人重启。

## 决策

`apps/cli` 中的 `dsh electron restart [args...]` 与 `start`/`stop`/`log` 并列成为一级 launcher 动作。命令本身从不询问"实例是否应该在运行"：它在终端上预检桌面应用与它的 binary，然后把"停止→启动"序列抛给一个分离的 supervisor——用内部 `DSH_ELECTRON_RESTART_SUPERVISOR` env 标记重新执行同一条 CLI（再次 `electron restart`），其输出追加到同一个 electron 日志。命令打印 supervisor pid 后立即返回；旧实例的收尾或调用会话关闭都无法丢弃尚未执行的启动。

supervisor 主体内联执行序列，保持状态无关，必定以全新启动收尾：

- 无 pid 文件——打印 `no electron pid file — starting fresh` 然后启动；
- 陈旧 pid——共享的 `stopDaemon` 移除文件后继续启动；
- 存活 pid——先跑共享的 SIGTERM→SIGKILL 协议并阻塞到旧进程消失，再继续启动。

只有扛过 SIGKILL 的进程会让序列中止（退出码 1，什么都不启动；结论落在日志里）。启动阶段与 `startElectron` 用的是同一个私有 `launchElectron`（app 目录检查、binary 检查、already-running 守卫、日志打开、pid 写入），因此失败顺序和信息与 `start` 完全一致；守卫在重启路径上是空操作，因为停止阶段已先移除旧 pid 文件。`restart` 之后的参数与 `start` 一样原样转发给 Electron 主进程（`dsh electron restart --dev`），包括默认那条提到 `dsh electron stop` 的 already-running 信息。自重启命令（`execPath` + 入口脚本 + loader 钩子）从 `web.ts` 私有的 `WebLauncher`/`resolveWebLauncher` 移入共享的 `daemon.ts`，改名为 `SelfLauncher`/`resolveSelfLauncher`，两个 launcher 现在共用。

## 备选方案

**在调用 CLI 进程内部执行"停止→启动"序列。**否决：该执行依赖调用进程在停止与启动之间存活——会话关闭或旧实例的收尾会先把它丢弃，这正是本命令要修复的"停了却永远没重启"故障；分离的 supervisor 对两者都独立。

**在 CLI 里组合 `stop` + `start`。**否决：它保留了状态依赖——"nothing to stop" 和 "already running" 恰恰在重启要修复的那些状态上报错——而且交接需要停止阶段阻塞到旧进程退出，单独一个 `stop` 无法保证下一次 spawn 之前进程已消失。

**写成文档化 shell 配方（`stop || true; start`）。**否决：配方掩盖了等待退出的环节，打印它压下去的令人困惑的 `stop` 报错，而且没有测试；一级动作自己拥有协议、信息，以及单元套件用的超时注入。

## 后果

现在一条命令即可从无法被停止动作丢弃的进程中恢复所有记录状态——无 pid、陈旧 pid、健康实例、无视 SIGTERM 的实例——并且只在旧进程扛过 SIGKILL 时失败，因此重启永远不会静默叠出第二个窗口。代价是重启后的应用启动与任何失败结论出现在日志而非调用终端上（配置错误仍在派发前于终端 fail loud），停止阶段在 supervisor 内最多等待 SIGTERM 宽限期（默认 3s），这与 `dsh electron stop` 已记录的 worst case 相同。`dsh web` 保持独立的仅 `stop` 表面；共享的 `daemon.ts` 停止协议除了承载自重启命令外没有改动。