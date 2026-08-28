# Agent Note: Electron 桌面 Cmd+W 关闭确认

Status: implemented

[English](2026-08-24-electron-close-confirmation.md) | 中文

## 问题

桌面应用（`apps/electron`）在 `Cmd+W`——macOS 惯用的关闭快捷键——按下时直接关闭窗口并 dispose host，没有任何确认。一次误按就会结束正在运行的 agent 会话，而默认菜单的 Close 项（macOS 上是 Cmd+W）也会直接关闭。host 自身不保存任何草稿，但它承载的会话状态恰恰是误击键不应丢弃的东西。

## 决策

`apps/electron/src/window.ts` 在 `before-input-event` 钩子上拦截 `Cmd+W` 的 keydown，阻止其到达 renderer 或默认菜单的 Close 快捷键，并经由[主进程快捷键路由](../architecture/2026-08-28-electron-main-process-shortcut-router.zh.md)分发；未被认领的按键才弹出以窗口为父级的原生 question 对话框（按钮 Close/Cancel，默认与 cancel id 均为 Cancel）。只有确认 Close 才调用 `win.close()`；既有的 `closed` → `window-all-closed` → `before-quit` → `host.dispose()` 生命周期原样继续。`confirmingClose` 守卫在对话框打开期间丢弃重复击键，`showMessageBox` 的 rejection（父窗口已不存在）按已说明的原因被吞掉。

刻意的范围：只拦截 `Cmd+W`，正是被要求的快捷键。窗口关闭按钮与 Windows/Linux 上的 `Ctrl+W`（那里默认菜单的 Close 快捷键）仍然无确认关闭，对话框文案为纯英文，不做 i18n 接线。

## 备选方案

**拦截窗口 `close` 事件。**否决：那会对每条关闭路径（按钮、菜单、退出）都弹确认，既不是请求所要求的，也会让常规退出变得嘈杂；还会给 `before-quit` 的 dispose 握手增加第二条提示路径。

**绑定自定义 Close 菜单快捷键并在其处理器中确认。**否决：应用没有自定义菜单，默认菜单已绑定 Close（macOS 上是 Cmd+W）；`before-input-event` 拦截在不触碰菜单接线的情况下覆盖了所请求的快捷键。

**本地化对话框文案。**暂缓否决：文案只是单个主进程模块里的两行，renderer 的 locale 机制无法从原生对话框触达，接 i18n 会是独立的工程。

## 后果

误按 `Cmd+W` 不再静默结束会话：用户会得到一个默认 Cancel 的原生确认提示——除非已注册的路由处理器认领了该按键。其余关闭行为完全不变，非 Cmd+W 关闭路径按设计跳过确认。路由语义（认领顺序、disposer、未认领回退）由 `apps/electron/tests` 钉住；对话框路径本身仍由包构建验证。
