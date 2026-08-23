# Agent Note: 文件变更 toolview 以共享行骨架之上的插件形态发布

Status: implemented

[English](2026-08-23-file-mutation-toolview-plugin.md) | 中文

## Problem

keyed `edit`/`write` 工具行（应用的 diff 卡片加行尾 `+A -R` 总计后缀）原本住在 `ui-tool` 浏览器插件内部，由 `apply.ts` 无条件挂载。这把一个可部署的展示选择糅进了核心包：想要这些行的部署必须带着它，不想要的部署只能改核心去掉它，行也无法装进别的 dsh web。把它搬出去的拦路石是客户端依赖规则：插件包除 cordis 装载所需外不导出任何值，且禁止跨插件包 value 导入另一插件的符号——而行复用的是 `ToolRow` 与纯 row/card model（`toolRowModel`、`diffCardModel` 等），这些是 ui-tool 内部实现，通用兜底行与详情面板也在用。

## Decision

行骨架现在是公开的展示库，文件变更行是独立插件：

- **`@deepseek-ai/dsh-client-ui-tool-kit`**（`packages/client/ui-tool-kit`）：`ToolRow` 加六个 row/card model 及其 CSS，从 ui-tool 迁出。其 `/client` 入口是消费方导入值的模块表库通道。它是动态行（不是 shell 静态种子的库），因为 model 会从 runtime 客户端半部导入 `abbreviateHomePath`/`resolveWorkspacePath`；消费方通过 `dsh.client.external`（首次真实使用）加 peer/dev npm 段声明请求。`ui-tool` 的通用兜底、`ToolDetails` 与内置行都改从它取。
- **`@deepseek-ai/dsh-client-ui-toolview-file-mutation`**（`packages/client/ui-toolview-file-mutation`）：带 diff 卡片与 `+A -R` 后缀的 `edit`/`write` 行，注册方式与之前一致（`ctx.slots.inject('tool.call.toolview', …)`）。web-app bundle 默认挂载（roster 行 `ui-toolview-file-mutation`）；移除该行即关闭增强展示，`edit`/`write` 回落到通用卡片。独立安装用 `dsh plugin --profile web add @deepseek-ai/dsh-client-ui-toolview-file-mutation`。
- **核心能力留在核心**：`diffLineCounts` 仍在 `ui-primitives`（任何消费方都能用同一行终止规则推导改动量），`ToolRow.summarySuffix` 仍是接受 `ReactNode` 的通用骨架槽位（todo 行以字符串使用）。

kit 与插件是两个新包清单项：`tsconfig.client.json`/`tsconfig.base.json` 条目、bundle 行、`web-app` 依赖，以及 kit 的 `/client` 模块请求。

## Alternatives considered

### 从 ui-tool 的 `/client` 入口导出 `ToolRow` 与 model

改动最小的方案：ui-tool value 导出骨架，插件导入。被否——它违反客户端导出纪律（新增 value 导出需要签核与匹配的消费方）与"禁止跨包 value 导入"规则，还会让每个第三方 toolview 都绑死 ui-tool 内部实现（上游未必会合并）。kit 让骨架成为稳定的公开契约。

### 插件自包含行，重复骨架

插件只从 `ToolCallViewProps` 自己渲染整行（`ui-skill` 的 `SkillRow` 模式），不共享库。被否——文件变更行只是完整 `ToolRow` 交互面（整行展开、运行扫动、路径链接、Inspect 胶囊、IN/OUT 标签）之上的一个小增量（后缀）；重复约 400 行骨架会与其他卡片行的统一交互分叉，且手搓已维护的展示。

## Consequences

- ui-tool 不再注册 `edit`/`write`；文件变更展示成为独立版本、可禁用、可安装的插件，fork 加的 `+A -R` 后缀特性无需核心改动即可被其他部署使用。
- kit 是首个真实的 `dsh.client.external` 请求；模块图门禁（`verify-client-packages`、bundle 纯度）校验提供方与环规则，第三方复用 kit 只需同样的一行 manifest 声明。
- kit 的测试随代码迁移：model 派生与 `ToolRow` 骨架钉在 kit 的 spec 里，插件行/注册钉在插件自己的 spec 里，ui-tool 保留兜底与详情面板覆盖。迁移用 `git mv` 保留历史。

## Testing

受影响套件（ui-tool、ui-tool-kit、ui-toolview-file-mutation）在 `pnpm run test:gui` 下通过；装载真实插件组合的 keyed 槽验收链在清理源码树里的陈旧构建产物（`pnpm run clean`）后通过——因为 `src/` 里陈旧的 `.js` 产物在 vite 的扩展名顺序下会遮蔽同名 `.ts` 源码。
