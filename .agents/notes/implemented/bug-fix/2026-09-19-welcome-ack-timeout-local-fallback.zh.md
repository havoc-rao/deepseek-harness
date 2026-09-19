# Agent Note: 欢迎通告确认在宿主写入挂起时本地降级

Status: implemented

[English](2026-09-19-welcome-ack-timeout-local-fallback.md) | 中文

## 症状

Web GUI 的空会话（欢迎）页可能让 Internal Testing Notice 永久卡住：点击
Continue 后，确认写入在设置传输层一直 pending，store 停留在 `saving`，按钮被
永远禁用，全视口 modal 遮罩挡住了它之后的一切交互。用挂起（永不 settle）的
`remote.settings.mutate` 复现：`acknowledge()` 无预算地 await `scope.set`，
一个既不 settle 也不 reject 的写入永远不会释放通告。遮罩按 modal 语义遮挡
背景是设计使然；缺陷在于通告本身无法被关闭。

## 决策

`WelcomeNoticeStore.acknowledge()` 让宿主写入与墙钟预算竞速
（`WELCOME_ACK_WRITE_TIMEOUT_MS`，默认 5 秒；测试可注入）。超时视为
"持久化不可用"：确认在进程内推进，并镜像写入 `localStorage`
（`WELCOME_ACK_LOCAL_KEY` = `dsh.welcomeNotice.version`，与宿主字段一样按
版本精确比较），刷新不会再次弹出通告。宿主明确拒绝（rejected）仍走既有
error 路径——拒绝与挂起是两种不同的用户可见语义，拒绝不能被掩盖。
`derive()` 在 `ready` 与 `unavailable` 两个分支都合并本地降级标记，已在本
浏览器确认过的用户不会再次被命名空间可用性卡住。

scope 在能应答时仍是唯一的持久传输；本地降级只填补宿主挂起留下的空缺。
超时之后迟到的宿主写入成功只会把派生确认从宿主源翻转为 true，与本地标记
不冲突。

## 事实

通过无头浏览器复现 modal 遮罩造成的交互丢失定位问题；传输挂起被隔离为
"空会话下 `scope.set` 永不 settle"，并用挂起的假 `mutate` 做单测。
新增覆盖：挂起写入超时 → 本地确认 + storage 持久化；命名空间不可用时读取
本地确认；本地写入失败时内存确认仍放行。包套件：240 通过。本改动只涉及
GUI 状态处理，不动 session 日志、快照或 SDK 表面。