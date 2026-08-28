# Agent Note: Paper-tone axis in the Web appearance settings

Status: implemented

[English](2026-08-28-web-paper-tone-axis.md) | 中文

## 问题

Web GUI 的外观设置只有浅色／深色／跟随系统一个轴。阅读表面（应用背景、侧栏、聊天气泡、输入框、代码块）只能是中性白或中性深色；想要暖色或带色调的"纸面"（米白、羊皮纸、护眼绿）的用户没有产品入口，且现有偏好机制总是由系统配色决定色调。

## 决策

外观设置行在 General 区新增了第二个独立轴：纸面色调（`ui-theme.paper`，取值 `default`／`cream`／`sepia`／`green`）。色调是 `src/paper-tones.ts` 中产品固定的表面重着色数据——每种色调十个到十五个别名 token，每个都带必填的 `{ light, dark }` 双变体——并放在与 `preference` 相同的持久化 `ui-theme` settings namespace 上，schema 默认值为 `default`，现有文档保持有效。

ThemeRuntime 与偏好轴一同拥有该轴：`setPaper` 经 settings scope 写入，`ThemeSnapshot` 携带 `paper`，`composeActive` 把色调层最后折叠——排在第三方 `overrideTokens` 层之后——因此产品色调压过动态层。呈现器无需感知：折叠后的 token 已在 `active.tokens` 里，`active.colorScheme` 仍驱动 `body[data-ds-dark-theme]`。因此系统配色永远不会选择色调：它只决定该色调两个调色板变体中的哪一个生效，羊皮纸纸面在系统切换配色时仍是羊皮纸。

引导行把持久化色调与偏好一同嵌入，在外壳挂载前把该色调对应配色方案的变体写成 body 内联变量，使首次绘制即已着色；该机制由[插件激活前的主题引导](../bug-fix/2026-08-10-pre-plugin-theme-bootstrap.zh.md)拥有。浏览器 settings scope 只校验 wire 值、不套 schema 默认值，所以 paper 字段出现之前写入的文档到达时缺少该键；`adopt` 在属主实现里解析默认值，而不是在 scope 里补（wire JSON 边界）。

`src/paper-tones.ts` 存放共享的 token 成对类型（`ThemeTokenModes`、`ThemeTokenOverrides`、`ThemeTokens`，从客户端入口原样再导出），使 node 引导与浏览器运行时共享同一张层表。v1 表面集合只覆盖阅读表面；直接消费静态 token 的组件与清单之外的 token 保持基础配色。

## 备选方案

**把纸面色调做成注册主题。** 选择羊皮纸会替换当前的浅色／深色主题，失去"跟随系统"；需求明确要求色调独立于系统轴存活。而覆盖层机制正是为了把色调族叠加到任意基础配色之上而存在的。

**单独的 settings namespace。** 写入串行化、revision 排序与拒写重载机制都是按 namespace 组织；第二个 namespace 只会把外观文档拆成两条 revision 流，持久化上毫无收益。两个字段共享 `ui-theme`。

**仅浏览器本地、不做 Host 持久化。** 主题包的持久化路径是产品约定；进程内色调会在重载后重置，并与引导嵌入不一致。

**在 settings scope 里套 schema 默认值。** scope 校验 wire 值并原样返回；改它的行为会影响所有已注册的 namespace。在 `adopt` 处补默认值可以保持 wire 约定不变。

## 后果

外观行在偏好方块下新增纸面色调入口——显示当前色调名，点击在本行展开选择面板，每种色调带一个纸色身份色板（取自共享表中该色调的浅色 `--dsw-alias-bg-base`，数据驱动；`default` 回退为中性纸白）。色调在重载、远端浏览器采纳与系统配色翻转后均保持，首次绘制无闪变即已着色。合成快照与检查用 token 目录都包含色调 token，第三方观察者能看到折叠后的值。代价：v1 的固定 token 清单需要一次 token 设计任务才能扩展，且纸色覆盖有意跳过直接消费静态 token 的组件。

## 测试

ThemeRuntime 规格钉住 `setPaper` 写入、按配色折叠、色调压过 `overrideTokens`、只改纸色的采纳与旧文档的 wire 默认；apply 规格钉住 store 镜像与写回路；appearance-row 规格钉住入口的收起态、展开、色板颜色、选中与点击面；引导规格钉住嵌入的变体；host 规格钉住 schema 默认与嵌入的色调。ui-layout 呈现器规格原样通过——呈现器从不感知这一轴。
