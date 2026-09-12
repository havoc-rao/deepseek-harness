# Agent Note：可持久化的右侧栏用户偏好

Status: implemented

[English](2026-09-12-right-panel-preference-persistence.md) | 中文

## Problem

右侧栏的宽度偏好与展开/收起状态此前只存在于浏览器内存中：`ui-layout` 的 `layoutInfo.rightbar`（已存储的 px，或派生的「首次打开 = 45%」规则）与 `ui-sidebar-right` 的逐 surface `expanded` 标记在每次刷新时都会重置——用户调整好的面板宽度与栏的开关状态无法跨重启保留。仓库本就拥有标准的按用户偏好路径——settings capability（Host 侧 `ctx.settings`、浏览器侧 `ctx.settingsScope`、由 `settings-file` 按身份持久化）——theme、locale、paper、conversation 都在用它承载同类持久化选择。

## Decision

右栏的两个持久化 section 按「特性各拥其名」拆分，两个包都遵循 theme 模板：共享的 schemastery schema 模块、在有 settings provider 组合时注册 namespace 的 Host 半、以及桥接实时 store 与持久 section 的浏览器侧策略。

`ui-layout` 拥有 `ui-layout` → `{ rightbar?: number | null }`。浏览器侧 `RightbarPreferenceSync` 在 section 就绪后把已存宽度播种进 store（更宽窗口存下的宽度经 store 自身钳制收敛），并且只在用户提交点持久化：首次物化（固化派生宽度）与拖拽松手（AppFrame 注入面的 `persistRightbar`，绝不写拖拽过程中的中间值）。双向等值守卫防止 adopt 与持久化互相回声；section 尚在加载时提交的宽度会在就绪后补写。

`ui-sidebar-right` 拥有 `ui-sidebar-right` → `{ rightbarExpanded?: boolean | null }`。浏览器侧 `PanelOpenPreference` 包装每个被铸造的 surface store，只有显式手势提交才会持久化——strip 的 toggle、展开按钮、任意 open——而响应式自动收起（`setExpanded(surfaceKey, false)`，唯一的 false 调用方，发生在窗口无法容纳「300px 面板 + 400px 中栏」时）永远不会写入。section 就绪后，栏按用户留下的状态重新展开，但只恢复第一个物化的会话 surface（连接就绪前挂载的会话无关停靠面永不恢复，因此不会吃掉会话栏所需的那次恢复）：手势在 raw 提交前就标记 surface 为 touched，避免 restore 与手势自身的同步通知竞态；任意显式手势都对所有 surface 取代恢复；之后铸造的 surface（新建会话）属于自己、以折叠态开始；窄窗口下 seat 的响应式规则仍然优先。通用设置新增一行宽度设置（步进 10px，复用 theme 字号行的版式），读取实时偏好，写路径与拖拽手柄走同一个 store action。

「未设置」是字段缺席，而不是显式 `null`：被 vendor 的 schemastery fork 把 null default 视作无 default，因此可空字段用 `z.union([..., z.const(null)])` 且不带 default 表达，两个策略都把 `undefined` 读作「产品规则生效」（45% 宽度、栏关闭）。

## Alternatives considered

**经由 layout store 的 localStorage 选项持久化。** `client/store` 提供了可选的 localStorage 持久化，但 settings capability 才是仓库的按用户偏好路径：按身份、带 schema 校验、Host 所有，且其它偏好都已走它。localStorage 会成为合约之外的浏览器级状态。

**宽度与开合状态共用一个 `ui-layout` namespace。** expanded 是 occupant 所有的记录性业务（`ui-sidebar-right` 只向帧报告，从不占有该值），合并会违反其它偏好 namespace 都遵循的特性所有规则。

**从 presentation 报告持久化 expanded。** 面板已通过 `ctx.layout` 报告 `shown`，但报告无法区分用户收起与响应式自动收起；store 实例层的手势包装是唯一存在该区分的地方。

## Consequences

重启后的应用恢复用户右侧栏宽度（或沿用派生的 45% 规则），并且只在显式手势留下展开状态时重开栏。随包发布的 web e2e 契约（「刷新后回到折叠默认态」）在同一改动中更新：刷新现在恢复持久化的开合选择，而 surface 重置为默认页；sidebar e2e 的展开辅助函数同时容忍「恢复」与「点击」两条路径的竞争。两个 settings namespace 在无 settings 传输的组合里是 no-op（远程浏览器页面保持进程内、memory 模式）。settings 文档新增两个注册方所有的 namespace；通用设置区多出一行宽度设置。`ui-layout` 的 AppFrame 新增注入面成员（`persistRightbar`）与 `settingsScope` 服务依赖，`ui-sidebar-right` 新增 `settingsScope` 依赖并包装其铸造的 store 实例——该包装是未来 occupant 侧持久事实挂载的文档化咽喉点。