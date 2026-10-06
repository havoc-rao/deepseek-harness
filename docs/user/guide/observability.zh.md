---
description: "为选定的 DSH 插件配置可选的 OpenTelemetry 性能追踪和指标，并在 SigNoz 中查看。"
---

# 收集性能追踪和指标

[English](observability.md) | 中文

## 概述

将选定插件的操作次数、耗时和追踪发送到 SigNoz 等 OpenTelemetry 收集器。收集是可选功能，默认关闭。启用前请批准目标地址和插件选择；示例既不授权收集所有插件，也不会自动为正在运行的 DSH 进程启用收集。

## 目录

- [准备收集器和运行时](#prepare-the-collector-and-runtime)
- [选择插件和信号](#select-plugins-and-signals)
- [验证并重启](#validate-and-restart)
- [检查收集并排查问题](#inspect-collection-and-troubleshoot)
- [关闭收集](#disable-collection)
- [进一步探索](#further-exploration)

-----

<a id="prepare-the-collector-and-runtime"></a>
## 准备收集器和运行时

你需要一个接收 OTLP HTTP/protobuf 的收集器，以及包含可选[可观测性插件](../../../packages/telemetry/observability-otel/README.zh.md)的 DSH 运行时。对于源码检出，请使用[开发指南](../../development.zh.md)中的完整构建，而不只是 Web 前端构建：仅重建前端不会将插件加入交付的运行时。刷新浏览器不会启用服务器端收集。

请使用自己控制的收集器，或明确批准外部目标地址。不要将未经身份验证的收集器或 SigNoz UI 暴露到公网。本指南假设收集器和 UI 已存在；安装和访问策略由部署运维人员负责。

对于远端 SigNoz 部署，部署运维人员可以调整以下 SSH 隧道模板。模板假设远端 OTLP HTTP 端口为 `4318`、UI 端口为 `8080`；请根据部署替换 `user@collector.example.com` 和远端端口。这是由运维人员负责的手动验证步骤，不是 DSH 自动配置命令。

```sh
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:14318:127.0.0.1:4318 \
  -L 127.0.0.1:18080:127.0.0.1:8080 \
  user@collector.example.com
```

请保持隧道开启。本机 DSH 可以使用 `http://127.0.0.1:14318` 作为基础 OTLP 端点；在 `http://127.0.0.1:18080` 打开 SigNoz UI。这些本地端口是示例，不是运行时默认值。另一台机器上的 DSH 进程需要其自身可以访问的收集器 URL。

-----

<a id="select-plugins-and-signals"></a>
## 选择插件和信号

应用前请检查[示例叠加配置](../../../apps/cli/config/examples/observability.patch.yml)。它以服务名 `dsh-local` 启用运行时，保持未列出的所有者关闭，并选择以下精确插件所有者：

| 所有者 | 追踪 | 指标 |
|---|---|---|
| `@deepseek-ai/dsh-api-gateway` | `true` | `true` |
| `@deepseek-ai/dsh-tool-fs` | `true` | `true` |
| `@deepseek-ai/dsh-tool-bash` | `false` | `true` |
| `@deepseek-ai/dsh-llm-deepseek` | `true` | `true` |
| `@deepseek-ai/dsh-llm-pi-ai` | `true` | `true` |

API Gateway 记录调用和流；它不是控制器。文件和 bash 工具按各自所属工具插件报告。DeepSeek 系列模型路由使用 DeepSeek 所有者；pi-ai 路由使用 pi-ai 所有者。选择所有者不会安装该插件，也不会触发未使用的操作。

如果需要不同策略，请将叠加配置复制到自己的配置位置。每条所有者规则必须同时包含 `traces` 和 `metrics`，值为 YAML 布尔值，不能是带引号的字符串。通过精确包名选择所有者，不支持通配符、前缀或作用域匹配。除非明确批准扩大收集范围，否则请保持 `collection.default` 关闭。全局 `traces.enabled` 和 `metrics.enabled` 开关可以独立关闭某种信号；追踪采样不会对指标采样。

DSH 辅助记录包含稳定的所有者和操作名称、结果状态、计时和可选重试元数据，不包含工具参数、结果、异常消息和堆栈。这些限制和所有者选择适用于 DSH 辅助记录，不适用于独立安装、使用全局 OTel API 的第三方插桩。请单独审核此类插桩。启用收集会消耗资源，不保证零开销。

-----

<a id="validate-and-restart"></a>
## 验证并重启

在检出根目录检查合并后的 Web 配置，不启动服务器：

```sh
dsh --profile web --patch apps/cli/config/examples/observability.patch.yml --dump-config
```

确认合并配置包含 `observability` 条目和预期规则。`--dump-config` 检查配置组合；它不会启动运行时、连接收集器或证明数据已被接收。

随后，进程负责人必须停止目标 DSH 应用，并使用批准的叠加配置和端点重新启动。以下启动模板是由该负责人执行的手动验证步骤；不要在已有 Web 服务器旁再启动它，以此替代对原服务器的重启。

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14318 \
  dsh --profile web --patch apps/cli/config/examples/observability.patch.yml
```

配置和环境在启动时读取。没有实时可观测性设置 UI。基础端点会追加 `/v1/traces` 和 `/v1/metrics`；特定信号的端点必须是完整 URL。任何启用的信号缺少明确端点，都会导致启动失败。即使配置 `enabled: true`，`OTEL_SDK_DISABLED=true` 也会阻止激活；仅设置环境变量不能启用未经批准的运行时。

-----

<a id="inspect-collection-and-troubleshoot"></a>
## 检查收集并排查问题

手动验证数据接收时，进程负责人应优先使用受支持的 headless 配置单独运行，应用批准的叠加配置并使用可丢弃的输入。执行选定的工具或模型路由。如果通过重启后的 Web 应用验证，请使用没有无关会话的隔离进程：所有者选择适用于整个进程，而不只是一个任务。未经单独批准，不要为真实用户数据启用收集。

在 SigNoz 中选择服务 `dsh-local`（或配置的 `serviceName`）和任务时间范围。追踪提供 `dsh.owner`、`dsh.operation` 和 `dsh.outcome`。指标为 `dsh.operation.count` 和 `dsh.operation.duration`，耗时单位为秒。示例中 bash 只收集指标，因此没有 bash span 是预期行为。请考虑批量发送和指标导出间隔；计时和限制见[运行时配置参考](../../../packages/telemetry/observability-otel/README.zh.md)。

如果没有数据，请检查隧道、收集器的 HTTP/protobuf 接收器、端点、服务过滤条件、时间范围、选定所有者和强制关闭环境设置。如果启动拒绝配置，请使用真正的布尔值、完整规则和文档列出的字段。如果源码更新后无法解析插件，请检查完整运行时构建是否包含该插件。收集是尽力而为的：队列溢出、容量限制、导出失败和进程丢失都可能导致数据丢失。

-----

<a id="disable-collection"></a>
## 关闭收集

移除叠加配置、将其 `enabled` 字段设为 `false`，或以 `OTEL_SDK_DISABLED=true` 启动，然后重启进程。编辑配置或更改 shell 变量不会影响正在运行的进程。关闭收集时不会创建 provider、exporter、interval 或 timeout。关闭 DSH 收集不会删除收集器已经保留的数据。

-----

<a id="further-exploration"></a>
## 进一步探索

- [可观测性配置、过滤和限制](../../../packages/telemetry/observability-otel/README.zh.md)
- [独立的 OTel 日志传输](../../../packages/telemetry/otel/README.zh.md)
- [CLI 配置和叠加配置](../../../apps/cli/README.zh.md)
- [外部插件埋点](../../extensions/signoz.zh.md) — 从其他工作区自主接入。

### 开发备注

无。
