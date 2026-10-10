---
description: "为其他工作区的扩展接入可选 OpenTelemetry 性能采集，并以 SigNoz 为后端示例。"
---

# 将扩展接入 SigNoz

[English](signoz.md) | 中文

## 摘要

为扩展操作添加观测，并验证向已批准的 OTLP 采集器选择性导出数据。本指南为其他工作区的实现 agent（智能体）提供受支持的起点；它不表示某个外部扩展或生产 SigNoz 部署已经通过测试。DSH 运行时使用标准 OpenTelemetry HTTP/protobuf，因此可以用其他兼容后端替代 SigNoz。

## 目录

- [确定执行进程](#identify-the-execution-process)
- [为 Host 插件添加观测](#instrument-a-host-plugin)
- [批准部署覆盖层](#approve-a-deployment-overlay)
- [验证采集与隐私](#verify-collection-and-privacy)
- [其他工作区 agent 任务清单](#other-workspace-agent-task-checklist)
- [进一步探索](#further-exploration)

-----

<a id="identify-the-execution-process"></a>
## 确定执行进程

先阅读目标工作区的源码、manifest（元数据清单）和启动配置。根据工作的执行位置选择集成方式，而不是根据仓库所在位置选择。

| 执行位置 | 集成职责 |
|---|---|
| DSH 进程中的 Cordis Host 插件 | 读取可选 `ctx.get('observability')`；由 Host 挂载并拥有运行时。 |
| 独立 Node 或其他语言进程 | 在该进程中拥有需明确启用的 OTel SDK、上下文传播、导出器和关闭流程。DSH 选择规则不会为其添加观测。 |
| 浏览器或客户端插件 | 经审核的 [`sessions.observeCreation` 能力](../../packages/api/session-controller/README.zh.md#client-references)仅限 `dsh-enhanced-workspace` 创建。就绪指对象层 `openState === 'open'`，不是 DOM 就绪。通过 Host 插件观测其他 Host 工作；不要将 Node 运行时导入客户端包。 |

独立进程需要自己的服务标识，以及从其主机可达的采集器 URL。`127.0.0.1` 指向该进程所在机器或网络命名空间；在 DSH 机器上打开的隧道不会自动供其他位置使用。DSH 不提供自动远程上下文传播。跨进程追踪父子关系需要单独审核的传播设计。

对于独立 Node 进程，工作区 agent 应先检查已有 OTel 设置，再选择标准 SDK 包，例如 `@opentelemetry/sdk-node` 和 HTTP/protobuf 导出器。SDK 初始化必须受该进程的明确启用开关控制，配置它自己的稳定 `service.name` 和可达端点，并通过现有进程生命周期等待 SDK 关闭。需要跨进程父子关系时，仅跨经过审核且受信任的节点传播 W3C 追踪上下文。这些是实现职责，不是已测试的外部进程操作方案；DSH 开关和辅助方法过滤不控制该 SDK。

仅包含诊断信息的 README 或 `dist` 产物不能证明功能产品入口已经存在。添加观测前应确定实际工作；不要从诊断产物推断或记录具体集成。应修改维护中的源码，而非生成的 `dist` 或 `lib` 输出，并通过目标工作区支持的构建流程重新构建。

-----

<a id="instrument-a-host-plugin"></a>
## 为 Host 插件添加观测

配置、元数据规则和生命周期保证由[运行时参考](../../packages/telemetry/observability-otel/README.zh.md)说明。以下已编译检查的示例演示对同步工作和原生 Promise 的可选服务访问；它不是某个具体扩展的实现。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-observability-otel'

const owner = '@example/dsh-extension'

export function observeWork<T>(ctx: Context, work: () => T): T {
  const observation = ctx.get('observability')
  return observation === undefined
    ? work()
    : observation.run(owner, 'extension.work', work, { kind: 'internal' })
}
```

仅类型导入使 Cordis 类型扩充生效，不会在执行时导入运行时。可选消费者将观测包声明为可选 peer 和用于编译的开发依赖；Host 部署声明运行时依赖，使 Loader 能解析挂载的插件。在本仓库中，DSH 依赖使用 `workspace:*`。在其他工作区中，使用兼容的已发布版本或该工作区实际的链接包策略，而不是无法解析的 `workspace:*` 范围。导入必须仅限 Host；静态值导入或副作用导入会破坏运行时可选性。

在代码与采集规则中一致使用扩展的确切所属 npm 包名，例如 `@example/dsh-extension`。所属者不是 scope、提供方路由或会话标识符。操作名必须是源码定义的稳定名称。辅助方法的元数据仅接受 `kind` 和 `retry`；不要添加参数、路径、正文内容、标识符、结果、私有属性、原始错误或堆栈。

### 工具与模型适配器

对于通过 DSH 工具注册表分发的工具，在 `defineTool` 选项或 `ToolDefinition` 中设置 `telemetryOwner`。对于 LLM（大语言模型）适配器，将 `{ telemetryOwner: owner }` 作为第三个参数传给 `ctx.llm.registerAdapter(providers, adapter, options)`。这些注册表路径已经观测分发和流生命周期；不要仅为启用采集再次包装同一生命周期。没有标注的注册不会获得推断的所属者。参见[工具参考](../../packages/core/tools/README.zh.md)和 [LLM 参考](../../packages/llm/llm/README.zh.md)。

### 流与终态

`run` 观测原生 `Promise` 的完成，不观测自定义 thenable 或惰性迭代器消费。在 `run` 内创建流并不能测量其完整生命周期。对于自定义流式工作，使用 `start`，并通过 `handle.with` 激活句柄以执行流创建、每次 `next` 和通过 `return` 的清理；若迭代器协议提供 `throw`，也应包含它。在清理后的 `finally` 路径中结束句柄，确保仅结束一次，包括消费者提前退出和清理失败的情况。

根据应用的终态协议分类完成结果：正常耗尽的迭代器仍可能带有错误、取消或超时终态记录。将这些记录映射为 `error`、`cancelled` 或 `timeout`；仅在成功完成时使用 `success`。保留原始值与错误、取消行为，以及迭代器清理。结束句柄不会中止应用工作。优先使用现有注册表集成，而不是复制手写流包装器；自定义包装器需要针对自身协议的聚焦测试。

辅助方法测量已完成操作的次数和耗时，不测量首次输出延迟或运行时资源使用情况。配置仅在启动时读取。Host 的 Cordis dispose（资源释放）负责提供方关闭；单次请求超时并不会施加总关闭期限。不要在共享该进程的插件内安装第二个全局 OTel 提供方。原始全局 OTel API 调用可以绕过辅助方法的所属者选择和元数据过滤，因此需要单独审核。

-----

<a id="approve-a-deployment-overlay"></a>
## 批准部署覆盖层

导出前，请运维人员批准信号、确切所属者、目标地址和保留策略。以下最小覆盖层模板仅选择示例所属者；应替换为目标扩展的实际包名。本地端点是明确指定的，需要从 Host 进程可达的采集器或隧道。

```yaml
- insert:
    - id: observability
      name: '@deepseek-ai/dsh-observability-otel'
      config:
        enabled: true
        endpoint: http://127.0.0.1:14318
        serviceName: example-extension-host
        collection:
          default: { traces: false, metrics: false }
          plugins:
            '@example/dsh-extension': { traces: true, metrics: true }
```

模板配置可在空环境快照下解析；这不证明 Loader 组合或远端入库。应将其适配到目标 profile，不修改随产品提供的默认配置。Host 必须安装兼容的运行时包，已有 `observability` 条目应更新而非重复添加。profile 验证、重启、隧道设置和入库排查见[运维指南](../user/guide/observability.zh.md)。

采集默认关闭。每条确切所属者规则均包含两个布尔信号，允许仅采集指标或仅采集追踪；全局信号开关可以独立关闭任一信号。追踪采样不会对指标采样。环境变量不能批准尚未获准的运行时，`OTEL_SDK_DISABLED=true` 会阻止激活。未经运维人员批准，不得将此模板应用到活动 profile。

-----

<a id="verify-collection-and-privacy"></a>
## 验证采集与隐私

使用一次性输入和隔离进程测试。辅助方法过滤不授权上传 Session 日志，独立的产品或 Session 遥测仍各自配置。

- 运行时缺失和采集关闭时，保留应用行为并验证零导出；关闭采集不会分配提供方、导出器、间隔定时器或超时定时器。
- 启用采集时，检查选中的所属者、排除的所属者、仅指标选择和信号开关。检查并发根操作和嵌套父子关系，包括被排除的父操作与选中的子操作。
- 覆盖成功、拒绝、取消、超时、流提前 return、终态错误记录和清理失败。验证没有遗留句柄，结果或异常保持不变。
- 解码导出的追踪与指标，检查其中不含参数、正文、路径、私有标识符、结果、异常消息或堆栈。单独审核任何原始全局 OTel 观测代码或独立进程 SDK。
- 在 SigNoz 中通过服务名、时间范围、`dsh.owner`、`dsh.operation`、`dsh.outcome`，以及 `dsh.operation.count` 和 `dsh.operation.duration`（秒）检查实际入库。仅有 HTTP 200 响应不能证明数据已入库或可在后端查看。

导出仅尽力而为：队列与容量限制、导出失败和进程丢失都可能导致记录丢失。需考虑批处理和指标间隔。采集器不可用时，应指定负责实际后端验证的运维人员；不要将未执行的操作方案标为已测试。

-----

<a id="other-workspace-agent-task-checklist"></a>
## 其他工作区 agent 任务清单

将此清单复制到目标工作区的 agent 任务中，并填入部署专用值。

1. 检查实际源码、manifest、Host/客户端划分和受支持的启动路径；确定包所属者与独立进程。
2. 阅读链接的运行时和注册表参考；选择可选 Host 辅助方法、注册表所属者元数据，或由独立进程拥有的 SDK。
3. 仅在目标工作区内实现，保持运行时导入仅限 Host，并在观测服务缺失或关闭时保留正常工作行为。
4. 为该集成添加适用的生命周期、并发、取消、关闭状态、选择性采集和隐私检查。
5. 准备尚未应用的 profile 覆盖层，其中包含已批准的所属者和可达端点；不要自动修改活动或随产品提供的 profile。
6. 返回修改文件、实际执行的命令、观察到的结果、尚未验证的后端入库，以及运维人员剩余的重启和验证步骤。

-----

<a id="further-exploration"></a>
## 进一步探索

- [观测运行时 API 与限制](../../packages/telemetry/observability-otel/README.zh.md)
- [运维配置与 SigNoz 查看](../user/guide/observability.zh.md)
- [扩展编写](../cookbook/extension-cookbook.zh.md)
- [工具编写](../cookbook/adding-a-tool.zh.md)与 [LLM 适配器编写](../cookbook/adding-an-llm-adapter.zh.md)

### 开发备注

无。
