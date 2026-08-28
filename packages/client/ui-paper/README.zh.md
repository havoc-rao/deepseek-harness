# @deepseek-ai/dsh-client-ui-paper

[English](README.md) | 中文

基于 ui-theme 服务的纸面色调特性插件：外观设置面新增独立于系统配色的表面色轴（`paper`，取值 `default`／`cream`／`sepia`／`green`）。插件拥有视觉层表（`src/paper-tones.ts`：每种色调十五个阅读表面别名 token，每个都带必填的 `{ light, dark }` 双变体），在 apply 时通过 `ctx.theme.registerPaperToneLayers` 贡献给主题服务（合成快照最后折叠该色调对应配色方案的变体），并在 General 设置区注册自己的行：显示当前色调的入口，点击在本行展开带数据驱动纸色身份色板的选择面板。写入走 `ctx.theme.setPaper`；持久化字段 `paper`、`PaperTone` 词汇表与 schema 归属[主题服务](../ui-theme/README.zh.md)（`ui-theme.paper`）。没有本插件时该字段仍会持久化，但不着色任何表面。

主机半区在主题引导行之后贡献自己的引导行：从主题 settings namespace 嵌入持久化色调与偏好，把该色调对应配色方案的 token 变体写成 body 内联变量，使首次绘制即已着色。深色解析与主题引导脚本保持一致，两条行在任何监听顺序下都互相吻合。

v1 token 集合只覆盖阅读表面（应用基底与层级、侧栏、聊天气泡、输入框、代码块）；直接消费静态 token 的组件与清单之外的 token 保持基础配色。扩展清单属于 token 设计任务。

## 模型体验

无。纸面色调管理浏览器偏好；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **纸色覆盖是固定的 v1 表面集合**：每种色调只重着色 `src/paper-tones.ts` 中列出的阅读表面；直接消费静态 token 的组件与清单之外的 token 保持基础配色。
- **没有主题服务的层注册时色调保持惰性**：插件在 apply 时贡献层表；HMR 折叠会清除贡献，已持久化的色调在该 fiber 恢复前停止着色。