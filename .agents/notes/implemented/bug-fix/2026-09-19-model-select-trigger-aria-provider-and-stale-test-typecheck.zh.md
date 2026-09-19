# Agent Note：ModelSelect 触发器 aria-label 提供 provider；陈旧已提交测试通过类型检查

状态：已实现

[English](2026-09-19-model-select-trigger-aria-provider-and-stale-test-typecheck.md) | 中文

## 问题

开发构建暴露出模型座分支状态上的两个既有缺陷：

1. `trigger.aria`／`trigger.ariaEffort` 模板带有 `{provider}` 占位符，但
   `ModelSelect` 的 aria 组合从未传入 provider 参数，因此可访问名称渲染出
   字面量 `{provider}`（例如 `选择模型，当前 DeepSeek-V4-Flash ·
   {provider}，推理等级 High`）。单元规范与 web e2e（
   `apps/web/tests/declared-reasoning.e2e.ts`）都期望 provider 显示名，所以
   渲染才是缺陷。
2. 三个已提交测试文件——
   `ui-layout/tests/panel-preference.client.spec.ts`、
   `ui-layout/tests/right-panel-width-row.client.spec.tsx` 与
   `ui-model-selection/tests/model-select.client.spec.tsx`——从未通过
   `tsc`：用 `import type` 导出的函数被当作类型使用（TS6133/TS2749）、
   隐式 any 的箭头参数（TS7006）、`ModelSelect` mock 缺少会话作用域 label
   槽位推导出的 `SessionProvider` prop（TS2741），以及对从未实例化的泛型
   key 直接访问 `renderSlot` 的 owner（TS2339）。它们共同把
   `NODE_ENV=development pnpm run build` 挡在 `tsc` 阶段。

## 决策

`ModelSelect` 在组合 aria 标签时传入 provider 显示名（目录路由可解析时用
`currentChoice?.group.name`，否则用 provider id），与 locale 模板及 e2e
期望一致。两个早于模板 provider 段的两处单元期望已更新（durable-model-id
与 loading 完成场景现断言完整的 `model · provider` aria）；未占用 label 的
场景分别断言模型标签与 effort 段，因为 provider 路径只通过 label occupant
渲染（由 label 槽位的测试用例覆盖）。三个测试文件已补全类型：store 工厂用
`typeof createLayoutStore`、`t` stub 箭头补显式参数注解、`SessionProvider`
stub（组件从不渲染它）传给每次 `ModelSelect` render，`renderSlot` 断言通过
`toEqual` 检查 owner 而不触碰其未实例化的泛型属性。

## 备选方案

从模板中移除 `{provider}` 占位符的方案被否决：e2e 期望与 label 槽位 owner
契约都要求可访问路径中带有 provider 显示名，因此模板才是规范，缺的是 aria
组合。用断言绕过缺失的 `SessionProvider` mock 的方案也被否决：槽位声明从
其会话作用域推导该 prop，因此 render 像其它框架 seat 一样提供 stub。

## 后果

composer 模型触发器触发器的可访问名称现在按规范播报 provider 路径（使 e2e
原本匹配的期望成立），三个陈旧测试文件可编译并通过，开发构建不再在
`tsc` 阶段变红。验证：`NODE_ENV=development pnpm run build` 退出码 0（240
个 client artifacts，含 code-finder locator 插桩），client-modules ／
ui-layout ／ ui-model-selection 套件全绿（238 个测试），所有改动文件
`oxlint` 干净。未改变 session-log、snapshot 或 SDK 表面；未改任何 locale
文本，仅改了 aria 组合与测试期望。