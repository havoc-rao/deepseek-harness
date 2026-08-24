# Agent Note:工作区 logo 作为可安装的 dsh 插件 bundle

Status: implemented

[English](2026-08-24-workspace-logo-plugin-bundle.md) | 中文

## Problem

工作区 logo 功能——选择器、宿主持久化记录、行/菜单/悬停卡渲染——当前横跨四个核心包:`dsh-workspace` zod schema 里的 `logo` 记录字段、`dsh-host-apiproxy` 静态 RPC 表里的 `workspace.setLogo`、运行时 `IWorkspaces` 面上的 `setLogo`、以及 `dsh-client-ui-workspace` 的行内渲染。`dsh plugin --profile <name> add <package>` 只能安装由行组成的 patch 层 bundle;它无法添加记录 schema 字段、RpcMethodMap 条目或行内 UI。因此该功能不可独立安装:每个 profile(包括 headless)无论是否使用它都携带它。

目标是成为可选插件:`dsh plugin --profile web add <bundle>` 挂载功能;未安装的 profile 显示纯文件夹图标、不发任何 logo RPC、行为与今天逐字节一致。

## Decision

两处核心扩展缝、一处刻意保留的核心事实、一个既是 bundle 又是插件的新包。

### 核心缝 —— `dsh-client-ui-workspace` 的行级 slot hole

ui-workspace 入口声明三个新的 `single` 类子洞,复刻现有 `directoryFlow` 模式([slot 系统标准](./2026-07-22-slot-type-chain-implementation.zh.md)):

| Slot | Owner props | 挂载后的行为 |
| --- | --- | --- |
| `sidebar.workspaces.workspaceIcon` | `workspaceId, label, logo, expanded, containsCurrent` | 真实工作区行的 16px 前导单元:占用者渲染 logo 图片;洞为空 → 呈现既有文件夹图标(基于占用的切换,与 add-workspace 入口同一机制) |
| `sidebar.workspaces.workspaceMenu` | `workspaceId, label, menuOpen` | 尾部省略号菜单扩展:占用者贡献"Add logo image"条目(重命名/删除留在核心) |
| `sidebar.workspaces.workspaceHoverIcon` | `workspaceId, label, logo` | 悬停卡头部:占用者渲染卡片尺寸 logo;洞为空 → 纯标题卡片 |

三者都是 root 作用域 `single` 洞。`WorkspaceLogoImage`、其尺寸/回退规则、选择器(`input[type=file]`、MIME/大小上限、data URL 读取)原样移入占用者。核心只保留无文件的文件夹回退。菜单分发留在核心:未知 id 本就在进入破坏性分支前返回。

### 刻意保留的核心事实

- 工作区记录 schema 的 `logo` 字段与实体 `setLogo` 留在 `dsh-workspace`:可选、惰性字段。无插件的 profile 永不写入;旧核心读新注册表时 zod 剥离未知键(pre-release 立场)。
- `IWorkspaces.setLogo` 与 `workspace.setLogo` RPC 留在核心:UI 插件是唯一调用者,休眠的 RPC 比 RPC 扩展缝更小的表面积。

### 插件包与 bundle 形态

`packages/client/workspace-logo/`(`@deepseek-ai/dsh-client-workspace-logo`,`dsh.client` platform `web`)填充三个洞;从洞的 owner props 读 logo;通过自己的 inject 面(包装核心 `ctx.workspaces.setLogo`)提交选取。

客户端包自带完整的 `dsh.bundle` 段(`dsh.bundle.patch` → 自己的 `cordis.patch.yml`,外加行与包依赖):它就是 `dsh plugin --profile <name> add` 消费的 patch 层 bundle,因此不存在独立的 `packages/bundle/workspace-logo/` 包。外部 profile 用 `dsh plugin add @deepseek-ai/dsh-client-workspace-logo` 挂载;盒内 web profile 通过 `dsh-web-app` 自身 patch 的行(`ui-workspace-logo`)与 `package.json` 依赖携带同一客户端包。

挂载/卸载:`dsh plugin --profile web add <bundle>` / `disable ui-workspace-logo`;禁用后占用者卸载,洞回退到文件夹图标(热更,与 directoryFlow 同一占用机制)。无会话格式变更,无模型可见变更。无 bundle 的 profile 没有参与文案键、不发 logo RPC、渲染文件夹图标。

## Alternatives considered

- **含 RPC 与域缝的完全拆分**:最大解耦——`workspace.setLogo` 与 schema 移入 bundle;代价是两条新能力缝(插件声明 RPC 注册表、可扩展域 schema)及各自的 Service Definition/Provider/Consumer 三件套、测试与 Agent Note。推迟:休眠 RPC 表面积小,域 schema 缝是仓库最大的架构投入。
- **独立的 `packages/bundle/workspace-logo/` 包**:与客户端包分开的 patch 层。否决:冗余——客户端包已经自带 `dsh.bundle.patch` 声明,bundle 缝零额外成本,且只需安装、构建、发布一个包。
- **在既有行上做功能开关**(`dsh plugin … disable` 核心内的行):不独立——功能仍在核心内,外部安装得不到任何新东西。
- **无行级洞的纯客户端 bundle**:行内容没有座位;否决——洞是唯一合规的组合路线。

## Consequences

- 三个 slot hole 扩大了 ui-workspace 的声明子项契约;只有 logo 保持插件形态时缝才物有所值——核心内功能仍可行内渲染。
- 动态客户端行在 HMR 卸载时会把洞留空(directoryFlow 占用机制已拥有该机制)。
- 推迟的 `ctx.rpcMethods` 缝是已记录的债务,而非意外:若后续轮次想让 RPC 也归插件所有,必须先建该注册表;RpcMethodMap 无论哪种方案都是静态的。
- 外部安装经 npm 解析;盒内解析沿用既有 bundle 机制。
- 装配后的 web 界面默认携带该功能(web-app patch 行属于发布的 profile),因此今天的表现保留,同时功能可独立移除。

## Testing

- 包测试:workspace-logo 的 apply/invariant/logo 套件,外加 ui-workspace 的 rows/workspace-browser 套件;typecheck、lint、build 与 `verify-client-packages` / `verify-cordis-config` gate 全过。
- 装配覆盖:`apps/web/tests/workspace-management.e2e.ts` 新增 logo 场景(菜单入口 → 选择器提交 → 持久化注册表记录 → 行与悬停卡图片 → reload 后 logo 保留),零 model 调用;同文件里过时的 session 卡复制断言同步为已发布卡片行为(复制能力位于 workspace 卡,由 `home-path-tilde` 快照固定)。