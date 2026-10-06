---
description: "供其他工作区中的扩展作者自助使用的集成指南。"
---

# 扩展集成

[English](README.md) | 中文

## 摘要

使用这些指南，将扩展接入可选 DSH 能力，而无需修改 DSH 运行时。每份指南都说明受支持的 API、扩展的职责、部署前提，以及从其他工作区返回的验证证据。

## 目录

- [选择指南](#choose-a-guide)
- [在其他工作区工作](#work-in-another-workspace)
- [进一步探索](#further-exploration)

-----

<a id="choose-a-guide"></a>
## 选择指南

[SigNoz 与 OpenTelemetry](signoz.zh.md) 介绍 Host 插件和独立启动进程的可选性能观测接入。SigNoz 是 OTLP 后端示例，不是运行时必需依赖。

-----

<a id="work-in-another-workspace"></a>
## 在其他工作区工作

向实现 agent（智能体）提供目标工作区、实际包和进程入口，以及相关指南。要求先检查源码再修改；诊断用构建产物不能证明功能集成已经存在。实现与测试应留在所属工作区中，修改采集策略或导出数据前必须获得运维人员批准。

指南中的任务清单是交接要求，不表示任意外部扩展都已完成集成或测试。应分别报告已执行的检查、尚未验证的数据入库，以及部署前提。

-----

<a id="further-exploration"></a>
## 进一步探索

- [扩展编写](../cookbook/extension-cookbook.zh.md)
- [Cordis 配置与服务访问](../cordis-primer.zh.md)
- [运行时 API 参考](../subsystems/README.zh.md)

### 开发备注

无。
