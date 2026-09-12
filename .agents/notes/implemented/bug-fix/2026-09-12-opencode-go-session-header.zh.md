# Agent Note: OpenCode Go 会话请求头

Status: implemented

[English](2026-09-12-opencode-go-session-header.md) | 中文

## Problem

OpenCode 的 Console Go 与 Zen 网关自 2026-09-05 起要求 `x-opencode-session` 请求头，缺少时回答 HTTP 400 `MissingSessionID`（[discussion #5495](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)、[pi#9326](https://github.com/earendil-works/pi/issues/9326)）。`@earendil-works/pi-ai` 0.85.1 不发送该头，上游修复也尚未发布版本，因此 `opencode` 或 `opencode-go` 路由上的每个 harness 请求都在推理前失败。harness 已经把稳定的按会话 `sessionId` 传给 pi-ai，DeepSeek 直连适配器也早已发送[自己的会话头](../feature/2026-08-11-deepseek-request-user-id-header.zh.md)，但 pi-ai 适配器没有转发任何内容。

## Decision

`dsh-llm-pi-ai` 会为到达 OpenCode 网关的请求附加 `x-opencode-session`：通过目录提供方 id `opencode` 与 `opencode-go`，或通过位于 `opencode.ai`（含其子域）的模型端点识别。取值是 `GenerateOptions.sessionId`；未点名会话的请求发送一个新 UUID，以便仍能路由。同名的部署配置 `headers` 条目优先生效，因为 profile 标头归部署所有。识别与请求头构造位于 `src/opencode-session.ts`，适配器把结果合并在它已发送的归属标头之下。提供方无关 API、Session 事件与配置字段均未改变。

## Alternatives considered

**等待 pi-ai 发版。** 上游已在 `main` 上修复以进入下一版本，但尚无已发布版本携带该修复，因此 OpenCode 路由在发版前一直不可用。

**新增按路由的 `sessionHeader` 配置字段。** 显式字段可让任意网关声明自己的头名，但它会让已知网关在每个部署都主动选择前一直不可用，而该网关的要求是固定的外部协议事实，不是部署选择。

**整个部署使用一个静态头值。** 现有 `headers` 字段已能这样拼写，它能恢复路由，却会让所有会话塌缩到一个亲和键上，从而破坏网关的提示词缓存路由。

## Consequences

OpenCode 网关请求携带 OpenCode 所需的亲和 id；其他所有路由不受影响。[`tests/opencode-session.spec.ts`](../../../../packages/llm/llm-pi-ai/tests/opencode-session.spec.ts) 覆盖提供方 id 与主机匹配、子域、无会话回退、部署覆盖，以及针对已安装目录的不可解析端点。[`tests/adapter.spec.ts`](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts) 断言某条 OpenCode 路由在线上携带该头，另一条路由则没有。网关主机与提供方 id 是固定常量；保持 `opencode.ai` 端点的 pi-ai 目录改名仍由主机匹配，而新的网关主机或提供方 id 需要在此处改一处。
