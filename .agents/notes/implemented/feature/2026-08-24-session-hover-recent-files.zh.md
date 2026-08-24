# Agent Note: 会话悬停卡片以目录树形式列出会话的输入/输出文件来源

Status: implemented

[English](2026-08-24-session-hover-recent-files.md) | 中文

## Problem

工作区浏览器的会话悬停卡片此前只显示标题、相对时间与状态。持久化的 `sessionStats` projection 已经从成功的变更结果 diff 折叠出全日志改动数字（见[对话盒台账笔记](2026-08-24-web-talk-box-change-ledger.zh.md)），但台账里的路径身份停留在宿主内部，因此任何"这个会话涉及了哪些文件领域"的表面在不打开会话、不分页历史的情况下都拿不到数据。文件列表正是 projection 缝要服务的全日志事实：它们必须经受分页、压缩与重启，并且必须在列表行上直接渲染，无需打开会话。

## Decision

**`sessionStats` 折叠维护两个不同路径台账，各自按最近使用倒序。** 输出台账持有每个成功变更 diff 触及的路径（write/edit）；输入台账持有每个成功读取窗口返回的路径（即线上的 `recentInputs`/`recentOutputs`）。已在台账中的路径被再次使用时移回最前；新路径前插。`filesChanged` 与增删行数保持为输出台账的数字，语义不变。

**读取信号是 read 工具持久化的窗口 meta。** 输入按成功的读取结果识别——其 `tool/result` `meta` 携带 read 工具的结构化窗口（`path` + `offset` + `lines`，其读卡片重放所依赖的形状），与 diff meta 一样做防御性收窄。没有该窗口的工具——`str_replace_editor` 的 `view`、`read_image`、搜索读取——不计入，这镜像了不带 diff meta 的变更工具对输出台账同样不计入。

**线上列表各携带最新 32 个路径。** 这是悬停展示的线上界限，远高于任何客户端行数上限。折叠状态本身不裁剪：台账是精确去重的依据，裁剪会导致被逐出的路径在再次使用时重复计数、悄悄抬高数字（台账状态随日志增长是该 projection 已记录的 Known Limitation，并非本次引入）。

**会话悬停卡片渲染两侧。** ui-workspace 的 `SessionNode` 从该行的 `projectionValues.sessionStats` 派生 `recentInputs`/`recentOutputs`（对 `dsh-session-stats/client` 的类型专用依赖，与 ui-deliverables 使用的合并模式相同），`recentFileTree()` 把每个列表折叠成展示行——每级目录先于文件、均按到达（最近使用）顺序，绝对路径去掉前导分隔符，Windows 盘符保留为首段。两个压缩规则让卡片保持短小：某侧重度只有单个文件时渲染为一行扁平的 VSCode 风格路径行（无目录脚手架）；只含单一子目录的目录链则合并成一行、直到某一层含有自己的文件为止，因此 `src/client/rows/` 显示为单行。位于会话工作目录内的路径按相对路径渲染——去掉项目根前缀——之外的路径保持完整形式。卡片把输入区渲染在输出区之上，各最多渲染 8 行，并通过本地化的 `+N` 行报告精确剩余量；某侧没有路径——或 projection 单元未挂载——时该侧标题不出现。列表实时更新：会话列表基线与 `session/projection` 推送帧已经携带该键，因此悬停显示当前台账，无需打开会话。

## Alternatives considered

- **为文件列表单独建一个 projection 单元**——会重复实现 applied-diff 折叠及其防御性 `meta` 收窄；session-stats 已经拥有该词汇与变更流管道。
- **基于 presenter 识别（调用视图 `locations`，同产出文件 chips）**——ui-deliverables 的词汇按渲染意图识别，但在 projection 折叠内同步求值 `presentCall` 需要带作用域的工具注册表，预设 standing 层无法提供；持久化的结果 `meta` 与重放一致且不依赖注册表。因此悬停、对话盒合计数字与输入台账共享同一词汇家族（持久化的结果 `meta`），不附带相关 `meta` 的工具一律不计入。
- **把持久化台账裁剪到线上上限**——逐出会丢失精确去重依据；被保留后再次使用的路径会重复计数。因此只裁剪线上输出。
- **按工具名从 `tool/call` 参数推导输入**——会在通用折叠里硬编码工具 schema 且无可重放依据；持久化的读取窗口是 read 工具自己记录的事实。

## Consequences

`sessionStats` 的 `stateVersion` 现为 4，更早版本持久化的 projection-cache 行会在下次使用时被丢弃并重新折叠。悬停卡片的列表与对话盒合计数字描述的是同一台账的呈现切片，两个表面不可能对"什么算改动"产生分歧。涉及大量文件的会话会让 projection 状态如既往增长；最新 32 个的线上界限使投递的负载保持小。会话悬停卡片把共享的 244px 卡片宽度覆盖为 300px（文件区需要空间容纳路径），被截断的行的完整累计路径仍放进 title 提示。

## Testing

projection spec 固定最近使用重排（再次使用把路径移回最前且不重复计数）、线上上限、读取窗口收窄（每个畸形与外来 meta 形状）与不变的合计数学。ui-workspace 的 tree spec 固定投影映射与 `recentFileTree` 的每个形状（顺序、根、单文件扁平行、单链目录合并、预算在下降中途与兄弟循环中途耗尽、防御性去重），rows spec 渲染两个悬停分区及其精确剩余行。`pnpm run test:gui` 全绿；两个改动的包保持逐文件 100% 覆盖率。