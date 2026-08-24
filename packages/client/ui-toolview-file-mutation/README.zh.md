# @deepseek-ai/dsh-client-ui-toolview-file-mutation

[English](README.md) | 中文

keyed 文件变更 toolview 插件：决定 `edit` 与 `write` 的 Tool 调用在 web 会话里如何渲染。行复用 ui-tool-kit 的共享 ToolRow 骨架，把应用的 diff 作为默认折叠的卡片主体；折叠摘要是被修改的路径（宿主打开链接），行尾带本次调用的总 `+A -R` 行数。出错的变更没有 diff，因此模型侧的错误文本经由 ToolRow 的 Output 区呈现，其首行作为折叠摘要。

这份展示原本糅合在 `ui-tool` 核心内；本插件是把增强行抽离出来的产物——任何部署都可以在不触碰核心的情况下挂载或去掉增强行，其他用户也能把该特性装进自己的 dsh web。

## 安装

web-app bundle 默认挂载本插件（roster 行 `ui-toolview-file-mutation`）。想关闭增强行，从 bundle 的 `cordis.patch.yml`（或你自己的 patch overlay）里移除该行即可——未被认领的 `edit`/`write` key 会回落到通用 Tool 卡片。独立安装到 profile：

```sh
dsh plugin --profile web add @deepseek-ai/dsh-client-ui-toolview-file-mutation
```

插件在 ui-tool 声明的 keyed `tool.call.toolview` 槽位注册 `edit` 与 `write` 两个 key，locale seat 为 conversation 命名空间。它通过声明的模块表请求，从 `@deepseek-ai/dsh-client-ui-tool-kit/client` 导入行骨架的值。

## Model Experience

无——本包只渲染已记录的 Tool 调用与结果，不改变模型请求、Tool 执行或 session 事件。

#### KV Cache effect

无。本包仅客户端展示。

## 已知限制与暂缓事项

- **仅 `edit` 与 `write` 两个 key**——其他携带 diff 类载荷的 Tool 调用经通用 Tool 卡片渲染;新 key(或独立的 `patch` 意图)需要在这里另行注册。
- **错误时无 diff**——错误 mutation 没有 diff 可展示,界面也不持久化;模型可见的错误文本是该行唯一的意图证据。
