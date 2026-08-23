# @deepseek-ai/dsh-client-ui-tool-kit

[English](README.md) | 中文

共享 Tool 行展示库。产品自带的 keyed `tool.call.toolview` 行（ui-tool 内置行）与独立插件贡献的行（ui-toolview-file-mutation）都组合同一套骨架：`ToolRow`（单行摘要、整行展开、运行扫动、路径链接、Inspect 胶囊），由基于冻结 call/result 切片的纯 row/card model 驱动——`toolRowModel`、`diffCardModel`、`readCardModel`、`searchCardModel`、`terminalCardModel` 与 `webCardModel`。骨架集中在一个库包里（而不是塞在 ui-tool 插件包内部），这正是第三方 toolview 插件能够成立的原因：插件包除 cordis 装载所需外不导出任何值，而本包的 `/client` 入口是公开的模块表库。

## 消费本库

keyed toolview 插件从 `/client` 入口导入值，并在 manifest 里声明模块请求：

```ts ignore-check
import { ToolRow, toolRowModel, diffCardModel } from '@deepseek-ai/dsh-client-ui-tool-kit/client'
```

manifest 必须把该行声明为模块表 external（本库是动态行，不是 shell 静态种子的库——它的 model 会从 runtime 客户端半部导入 `abbreviateHomePath`/`resolveWorkspacePath`）：

```json
{
  "dsh": { "client": { "external": ["@deepseek-ai/dsh-client-ui-tool-kit/client"] } }
}
```

并在 `peerDependencies` 与 `devDependencies` 里声明 `@deepseek-ai/dsh-client-ui-tool-kit`（依赖规则见 packages/client/AGENTS.md）。model 与 `ToolRow` 都是 props 的纯函数，这里不读取任何 session 服务。

## 行契约

`ToolRow` 渲染一行折叠态：16px 前导槽（错误/中断时是状态点，否则是工具图标）、标题、分隔点、FILL 截断的摘要——可选地以不收缩的 `summarySuffix` 收尾（todo 行的并行计数、file-mutation 行的 `+A -R` 总计）。任何 body、output 或 card 材料都会让行可展开；展开体在行内滚动。每次调用最多声明一种 card 意图，card 种类互斥。提供 `filePath` + `onOpenFile` 时路径摘要渲染为宿主打开链接；错误行的折叠摘要改为失败首行。

每个 card model 把线上的 `callView`/`resultView` 收窄为原语的 props，对一切不匹配或畸形载荷返回 `null`，让调用走通用路径而不是让行或详情面板崩溃。`CHAT_*_MAX_LINES` 常量在聊天流里给卡片封顶（详情面板保留原语的全高默认）。

## Model Experience

无——本包只渲染已记录的 Tool 调用与结果，不改变模型请求、Tool 执行或 session 事件。

#### KV Cache effect

无。本包仅客户端展示。
