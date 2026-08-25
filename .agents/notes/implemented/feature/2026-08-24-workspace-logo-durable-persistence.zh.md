# Agent Note:工作区 logo 的持久化存储

Status: implemented

[English](2026-08-24-workspace-logo-durable-persistence.md) | 中文

## Problem

每个工作区可以携带一个 logo 图片,替代浏览器树中的文件夹图标。最初的实现只把选取的图片放在浏览器侧(组件状态,后来是 viewing store 的 localStorage):`dsh web` 停止/启动——或任何 origin 变化——都会清空它,logo 始终没有跟随工作区的持久化数据。宿主工作区记录没有 logo 字段,工作区行 UI 只消费 `WorkspaceView` 投影。

## Decision

logo 是宿主持有的持久化工作区数据:

- `dsh-workspace` 在工作区记录中新增可选的 `logo` data URL 字段(zod `.optional()`,与所有记录字段一样在读边界校验),实体暴露 `logo` 与 `setLogo(logo: string | undefined)`。
- 实体在持久化写入边界强制 data URL 长度上限:域写入路径不会重新校验记录,超长写入会破坏下一次注册表打开。
- 导线新增 `workspace.setLogo(workspaceId, logo: string | null)`——null 清除 logo——以及 `WorkspaceView.logo`。两个相同的 `LOGO_IMAGE_DATA_URL_MAX_LENGTH` 常量分别位于 dsh-workspace 的 spec 与 api/ 层(api/ 保持零宿主依赖);rpc-schemas 套件用相等断言钉住两者。
- 浏览器由 `tree.ts` 从 `WorkspaceView.logo` 派生 `group.logo`,并喂给工作区行的 hole owner 会话。自[插件化决策](../architecture/2026-08-24-workspace-logo-plugin-bundle.zh.md)起,选择器、菜单项、悬停卡 logo 与持久化提交(`ctx.workspaces.setLogo`)都位于独立的 `dsh-client-workspace-logo` 插件;行核心在洞空时保留文件夹图标/纯标题卡片作为回退。早先的浏览器本地存储方案(组件状态,后来是 viewing store 在 persist key v6 下的 `workspaceLogos`)已回退;viewing store 恢复为加入 logo 前的形态与 key。

注册表域版本保持 2:字段严格增量,旧记录可解析,zod 在旧代码打开新数据时会剥离未知键。

## Alternatives considered

- 浏览器 localStorage store(早先的尝试):origin 绑定,`dsh web` 重启后静默丢失,且把内容塞进 viewing-state store。被本笔记修复的这个已观察到的失败否决。
- 工作区目录内的 logo 文件加 webserver 静态资源路由:字节的自然归属,但需要新的静态服务、缓存与失效机制来服务一个 16px 头像;记录内 data URL 是更小的表面积。

## Consequences

- logo 跨 web 停止/启动保留,随工作区注册表移动,删除工作区时一并清理。
- 注册表 JSON 每个 logo 最多膨胀约 2.8 MB base64;一个含多个大 logo 的工作区会放大注册表文件与每次写入,受上限与选择器 2 MiB 图片字节限制约束——尚无降采样。
- logo 是宿主内容,永不进入模型可见面:无会话日志事件,`SESSION_FORMAT_VERSION` 不变。
- 客户端选取流程尚未纳入装配后的 web 快照套件;单元覆盖钉住每一层(实体持久性、RPC 与 schema、manager 回显、行渲染)。