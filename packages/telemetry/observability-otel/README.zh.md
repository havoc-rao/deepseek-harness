---
description: "通过标准 OpenTelemetry OTLP HTTP/protobuf 按需收集插件性能追踪和指标。"
kind: "package-reference"
---

# @deepseek-ai/dsh-observability-otel

[English](README.md) | 中文

## 概述

经用户明确批准后，收集操作耗时、计数及嵌套追踪。可按精确插件所有者分别选择追踪和指标，包括仅收集指标。关闭收集时不创建提供者、导出器或定时器。导出的操作元数据不包含参数、结果、异常消息或堆栈。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待完成工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

此可选 Cordis 服务提供 `ctx.observability`；未声明必需注入的调用方读取 `ctx.get('observability')`。它不替换独立的 [OTel 日志传输](../otel/README.zh.md)，不在内置配置中自行启用，也不通过提示框获取同意。操作人员必须先批准端点和收集策略，再启用服务。

### 配置

默认值为 `enabled: false`。启用时必须明确指定端点和收集规则。基础端点分别追加 `/v1/traces` 和 `/v1/metrics`；信号专用端点为完整 URL。不隐式选择本机收集器。启动解析拒绝错误的字段类型、空值和未知字段；字符串 `"false"` 不能代替布尔值 `false`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 操作人员明确批准。 |
| `endpoint` | 未设置 | HTTP(S) 收集器基础 URL；环境回退项为 `OTEL_EXPORTER_OTLP_ENDPOINT`。 |
| `traces.enabled`, `metrics.enabled` | 批准后为 `true` | 独立的提供者开关。 |
| `traces.endpoint`, `metrics.endpoint` | 未设置 | 完整信号 URL，优先于信号专用环境值和基础端点。 |
| `collection.default` | `{ traces: false, metrics: false }` | 未命中精确规则的所有者所用策略。 |
| `collection.plugins` | `{}` | 精确 npm 风格所有者名称映射到完整的 `{ traces, metrics }` 规则；不匹配作用域、前缀或通配符。 |
| `traces.sampleRatio` | `1` | 基于父级的根追踪采样比例；不采样指标。 |
| `serviceName`, `serviceVersion` | `dsh`、未设置 | 明确的资源身份；未指定名称时使用 `OTEL_SERVICE_NAME`。 |
| `maxQueueSize`, `maxExportBatchSize` | `2048`, `512` | 有界跨度队列和批次条数。 |
| `scheduledDelayMillis`, `exportTimeoutMillis` | `5000`, `5000` | 跨度批处理延迟和单次导出超时。 |
| `metricIntervalMillis`, `metricCardinalityLimit` | `30000`, `2048` | 指标读取器间隔和 SDK 聚合上限。 |
| `maxActiveOperations`, `maxOperationNames` | `4096`, `256` | 帮助方法生命周期数量和不同所有者/名称组合上限；溢出时跳过收集。 |

即使已明确批准，`OTEL_SDK_DISABLED=true` 也会强制关闭。`OTEL_TRACES_EXPORTER=none` 和 `OTEL_METRICS_EXPORTER=none` 分别禁用对应信号。这些环境变量不能启用未经批准的运行时。启用的导出器仅接受 `otlp` 和 `http/protobuf` 协议；不支持的选项在配置解析时失败。OTLP 请求头等 SDK 导出器环境设置由标准导出器处理。不创建日志导出器。不启用资源探测器或任意 `OTEL_RESOURCE_ATTRIBUTES`。

### 埋点

`run(owner, operation, fn, attributes?)` 返回回调原始结果（包括原生 Promise 身份），并重新抛出原始异常。Promise 完成或拒绝时结算操作。流使用 `start(owner, operation, attributes?)`，以 `handle.with(fn)` 包裹每次迭代器操作，并在清理时调用 `handle.end(outcome)`。结果分类为 `success`、`error`、`cancelled` 和 `timeout`；取消分类不会中止应用工作。启用追踪时，句柄暴露标准 OTel `SpanContext`。

所有者标识负责工作的插件，而非运行时作用域。操作名称必须来自源码或可信注册元数据，绝不能插入参数、路径、会话 ID 或模型内容。名称允许 ASCII 字母、数字、空格、下划线、句点、斜杠、冒号和连字符，以字母开头，最长 160 个字符。属性仅允许 `kind`（标准跨度类型）和 `retry`（布尔值）。禁用的所有者保留最近的活动父级，因此启用的后代仍可正确嵌套。指标在结算时记录计数和耗时，独立于追踪采样。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[配置解析器](src/index.ts) 在[运行时](src/runtime.ts) 获取资源前固定批准状态、环境、端点优先级和资源上限。单个活动实例拥有进程全局 OTel 上下文管理器和选定的提供者。第二个实例或冲突的全局注册会失败，而不会替换其他提供者。激活失败时会等待已获取提供者完成回滚后再拒绝；排空完成前保留进程所有权。标准 OTel API 跨度在异步延续中继承帮助方法上下文。Cordis 释放时停止帮助方法收集，将活动句柄标记为取消，禁用自身拥有的全局注册，并等待 SDK 关闭后才允许后继实例启动。

[运行时测试](tests/runtime.spec.ts) 覆盖内存导出器、并发根操作、禁用所有者的父级关系、标准 API 父级关系、仅指标所有者、取消、容量、关闭状态定时器和 Cordis 释放。[传输测试](tests/transport.spec.ts) 使用临时本机监听器验证独立的追踪和指标 HTTP/protobuf 请求，不连接远端收集器。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为性能收集不增加模型可见输入，也不改变模型输出。

#### KV 缓存影响

无；埋点不改变模型请求。

## 已知限制与待完成工作

<a id="known-limitations-and-deferred-work"></a>

收集采用尽力而为策略，仅保存在内存中。

- 所有者过滤和安全元数据仅适用于此服务的帮助方法。独立安装的第三方 OTel 埋点可以通过全局 API 发出不受这些规则约束的任意跨度或指标；仅启用经过审查的埋点。
- 跨度队列溢出、操作容量上限、导出器失败和进程丢失均可能导致数据丢失。稳定诊断通过 OTel `diag` 发出，不附带原始错误；不会自动安装诊断日志器。
- 关闭会等待 SDK 静止。请求超时和队列上限约束工作量，但没有独立强制执行的总关闭截止时间或强制传输取消。
- 自动观察原生 Promise；自定义 thenable 和惰性迭代器需要手动句柄。调用方必须结束手动句柄；服务释放会关闭剩余句柄。
- 配置仅在启动时生效。不提供运行时资源指标、自动埋点、远端上下文传播、持久化缓冲、自定义重试策略或实时设置界面。

<a id="dev-note"></a>
### 开发备注

无。
