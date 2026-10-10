---
kind: upgrade-guide
description: "自定义后台任务提供者必须实现 JobHandle 的已确认 Session 关联并发布关联变更。"
---

# 后台任务 Session 关联

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-jobs` 新增必需的 `JobHandle.setSession(sessionId)` 方法及 `JobEvent` 的 `session` 成员。构造 `JobHandle` 的外部提供者和测试替身必须实现该方法。穷尽处理事件的消费者必须处理新事件。`JobView.sessionId` 和 `description` 为可选字段；现有生产者只有在需要展示目标 Session 时才需改动。

## 迁移

1. 在自定义任务提供者中实现 `setSession`：暂存 `JobSpec.run` 内的调用，注册提交后发布关联，运行期间变更时发出 `session` 事件，结算后保留最后一次关联，并警告且忽略后续写入。
2. 更新穷尽处理 `JobEvent` 的代码，将 `session` 作为生命周期投影更新处理。关联不改变所有者授权。
3. 只发布已确认且可导航的宿主 `SessionId`，不要发布预分配身份或外部运行 ID。`JobSpec.description` 提供可选的单行上下文。Web 后台任务列表使用已确认关联提供独立的导航动作。
4. 编译提供者，验证运行期间建立的关联出现在任务列表中，且完成后仍然保留。参见[任务提供者参考](../../../../packages/jobs/jobs/README.zh.md)。
