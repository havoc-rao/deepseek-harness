# Agent Note: open-in-app workspace 目标 provider

Status: implemented

[English](2026-09-14-open-in-app-workspace-target-providers.md) | 中文

## 问题

会话头部的 Open In 分体按钮始终在会话 `cwd` 上解析*本地*应用。像 dsh-remote 这样的远端部署会把远端主机的 workspace 镜像成本地目录，并把会话 cwd 设在该 mirror 内，于是按钮用本地编辑器打开了 mirror 副本，而不是经 Remote-SSH 打开真实远端目录。host 路由没有扩展点让拥有该路径的插件接管，浏览器也只每页读取一次可用性而非按 workspace 路径读取，因此被认领 target 的目录与远程语义无处抵达。

## 决定

**`dsh-host-open-in-app` 以服务 `ctx.openInApp` 发布 host 侧 provider 注册表。** [`src/provider.ts`](../../../../packages/host/open-in-app/src/provider.ts) 定义类型并拥有 `OpenInAppProviderRegistry`，`apply` 用 `ctx.provide('openInApp', registry.service)` 发布它。该服务只有一个方法 `registerProvider(provider)`，返回注销该 provider 的 disposer；注册插件把 disposer 接进自己的 `ctx.effect`，让 provider 随它一起卸载。两个相同 `id` 的 provider 会在注册点报错。其他插件用 `ctx.get('openInApp')` 读取，拿不到时优雅降级，因此浏览器半边不注册任何东西。

provider 是 `{ id, resolve, launch }`。`resolve({ path, sessionId? })` 返回 `OpenInAppTarget | null`，`Target = { provider, label, apps }`：`provider` 等于 provider 自己的 `id`，`label` 是给人看的来源标识（例如 `root@host:/srv/app`），`apps` 是该 target 上可用的目录 id，顺序即菜单顺序。`null` 表示放弃该路径，交给内置本地行为。`launch({ app, path, sessionId? })` 在认领的 target 上打开 `app`。

**路由先咨询 provider 再走内置解析。** `GET /open-in-app/apps?path=<绝对路径>&sessionId=<id>` 应答 `{ apps: string[], target: { provider: string, label: string } | null }`：被认领时提供 provider 的目录与 target，其他请求——包括所有不带 `path` 的请求——提供内置目录且 `target: null`。`POST /open-in-app/open` 现在接受 `{ app, path, sessionId? }`，按认领 target 的 `apps` 校验 `app`，且被认领路径只通过 `provider.launch` 启动。被认领的启动失败应答 502，绝不回退到用本地应用打开 mirror 路径。provider 的 `resolve` 期限是校验过的 Config 字段 `providerTimeoutMs`；抛错或错过期限的 provider 视为放弃该路径，因此一个坏 provider 既不能弄挂 apps 路由，也不能挂住按钮。图标路由、connection 信任栅栏、`application/json` 媒体类型校验、64 KiB 上限与绝对现存目录校验保持不变。

**浏览器半边按 workspace 路径读取可用性。** [`src/client/controller.ts`](../../../../packages/client/ui-open-in-app/src/client/controller.ts) 发布以 workspace 路径为键的快照映射，共享同一路径的并发读取，每个路径每页只读一次，并把失败的读取降级为空目录。组件在 `cwd` 变化时向 controller 请求该 `cwd` 的可用性，并把认领 target 与 apps 一起发布，因此 tooltip 标明远程来源（双语 `open-in-app` 命名空间的 `open.tooltipRemote`、`open.titleRemote`），而 `target === null` 保持现有本地外观。

## 考虑过的替代方案

**从浏览器半边注册 provider。** 拒绝：路径归属与启动都在 host 上——真实远端目录与编辑器在那里；浏览器注册需要一套 wire 协议才能触达它们，而且自身无法启动任何东西。

**用 Typert Remote 方法替代路由。** 拒绝：本包刻意在一趟 host 解析之上提供裸 `webServer` 路由，而 provider 是同进程 host 代码。Remote 会为一个并不增加触达范围的能力引入传输层与生成类型面。

**去掉 `Target` 的 `provider` 字段、由 host 打戳。** 拒绝：provider 本就知道自己的 id，返回完整 target 让 `resolve` 与 wire 共用一种形状。host 信任返回的 `provider`，形状文档规定它等于 provider 的 `id`。

**被认领的启动失败时回退本地启动。** 拒绝：当远端插件已认领该路径时，打开本地 mirror 路径恰恰是最错误的结果。路由改为上报失败，浏览器显示其错误态。

**把 provider 错误或超时当作路由错误。** 拒绝：扩展点不能让一个坏 provider 打崩按钮。放弃是文档化的降级方式，其余 provider 仍会轮到。

**硬编码解析期限。** 拒绝：有用期限随 provider 的传输方式变化，因此 `providerTimeoutMs` 是可在 cordis.yml 中改动的校验 Config 字段，而不是常量。

## 后果

host 插件可以认领 workspace 路径并拥有其启动，这正是 dsh-remote（另一个仓库）要实现的能力。本包的 Config 增加了必填字段 `providerTimeoutMs`，因此挂载本包的既有外部组合必须设置它。provider 只能提供已在 `OPEN_IN_APP_CATALOG` 中的应用 id：图标路由与浏览器词典都是内置的，词典叫不出名字的 id 不会显示。可用性现在每个 workspace 路径每页读取一次，而非每页一次，且每个会话头部显示自己 cwd 的 target。provider 解析失败与超时会降级到内置本地 target，这保持了按钮可用，但也意味着暂时故障的 provider 可能短暂地让远端路径暴露本地行为。
