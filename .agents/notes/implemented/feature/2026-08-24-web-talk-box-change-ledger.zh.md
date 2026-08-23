# Agent Note: 每个 talk box 记录会话累计文件改动

Status: implemented

[English](2026-08-24-web-talk-box-change-ledger.md) | 中文

> 范围：在每个 talk box 下渲染会话累计改动台账——不同改动文件数加增删行合计——由持久化日志折叠而来。不在范围内：真实的 `git diff` 数字（宿主不会为展示而运行 git），以及按 hunk 或按轮的细分数字。

## 问题

diff 卡展示了每次 write/edit 调用的 `+A -R`，但没有任何东西能一眼回答"会话截至目前改了多少"。产物行只列出当前轮次的产出；累计视图需要逐张阅读卡片才能拼出来。全日志数字也无法从可见窗口计算：聊天窗口是分页的，压缩会重写窗口，因此基于屏幕内容的客户端折叠会随分页而改变。

## 决策

**`sessionStats` projection 新增三个由持久化日志折叠的改动字段。** `filesChanged`、`addedLines`、`removedLines` 对每个成功的 `tool/result`（其不透明 `meta` 携带已应用的文件 diff——即 write/edit 工具附加的形状）累加。不同路径在全日志内只计一次；行数按 Web diff 卡相同的换行规则累加（空文本为零行、末尾单个换行终止、内部空行计一行），因此台账与每个调用级卡片一致。失败的结果与不含 diff 的结果不计入，折叠像 diff 卡模型一样防御性地收窄不透明的 `meta`。projection 是官方认可的全日志归属地（与统计条相同的分页/压缩保证），因此这些数字两者都能承受。

**write 创建操作现在把已应用的 diff 记入 `meta`。** write 工具的 `presentationMeta` 对创建操作发出 `{ diffs: [] }`，于是重放回退到由参数派生的整文件 diff，而持久化的 meta 描述的是"没有改动"。现在 meta 就是卡片展示的 diff（`oldText: null`、完整新内容），这让 projection 能计入创建操作——也让持久化 meta 自描述。可见卡片不变。

**产物行充当 talk box 的台账。** `ProducedFiles` 在标签 lane 下方渲染累计数字，读取 `useProjection('sessionStats')`；其链选择器在每个轮次都认领（不只是有产出的轮次），组件在既没有产出标签也没有任何会话改动时返回 null——只读轮次通过展示累计数字隐式记录"没有新改动"，没有任何改动的会话则什么都不显示。未装配 session-stats 单元的组合不提供 projection 值，台账自然缺席（产物标签照常显示）。Web 统计条的窗口折叠不扩展：没有该单元时，改动字段缺席而非给出窗口近似值。

## 备选方案

- **在宿主上运行 `git diff --stat` 并实时推送**——诚实的 git 数字，但这是重放无法重新计算的实时展示通道，还要求 workspace 是 git 树、且不依赖未记录的改动物。会话日志折叠按构造可重放，回答"会话的文件工具改了多少"——这正是该行已有的主张。
- **客户端基于快照窗口的累计折叠**——在分页与压缩下不正确；持久化 projection 正是为全日志事实而存在。
- **projection 自己配对 `tool/call` 参数来计入创建操作**——把工具名及其回退逻辑硬编码进通用折叠。让工具自己的 `meta` 携带已应用 diff 保持了不透明形状契约（"产出工具拥有并收窄"）。
- **为台账单独开一个 turn-tail 行**——该行已位于 talk box 尾部，并共享其 opener/locale 机制；一行、一个主张。
- **`str_replace_editor` 的 diff**——它目前不记录结果 `meta`（只有参数派生的 call 视图），因此保持不在台账内，而不是教折叠学习第二种工具形状。

## 后果

`sessionStats` 的 `stateVersion` 升到 2，改动前持久化的 projection 缓存被丢弃并重新折叠。这些数字是累计和而非净额：同一文件的多次编辑累加，diff 卡的上下文行两侧都计。`apps/web/tests/produced-files.e2e.ts` 用真实的 create-meta 形状种子化 write 结果并固定装配后的台账文本（`Total: 10 files · +10 -0 lines`）；tool-fs 的 create-meta 测试固定新的持久化形状；projection spec 固定折叠行为，包括每个畸形 meta 守卫。
