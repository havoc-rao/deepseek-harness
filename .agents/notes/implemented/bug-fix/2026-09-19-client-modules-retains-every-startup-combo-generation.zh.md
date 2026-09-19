# Agent Note：client-modules 保留每个内容寻址的启动 combo 代际

状态：已实现

[English](2026-09-19-client-modules-retains-every-startup-combo-generation.md) | 中文

## 问题

开发环境 harness 启动可能卡在启动页的 "Failed to load plugins"，并伴随
`failed to import loader entry <hash> (<package>): client-modules: bundle
script /plugins/??... failed to load`。该 combo URL（62 个 entry 的
application batch，rev `20c29c168dfd`）返回 404，而 bootstrap combo 仍可
加载，因此所有 application entry 都激活失败。缺失 bundle 不是原因：同一
页面的启动图里就带着该 URL，而全新宿主进程启动时它能返回 200——只有在
重组合之后该 URL 才变成 404。

`ClientModuleRegistry` 只保留一代先前的 batch 响应（
`previousBatchResponses`）：每次 `rebuilt()` 重组合都会替换启动 batch URL
（它们对合并后的 bundle 字节取哈希）、把当前代移入单代缓冲、并把原来的
那一代丢弃。开发重建风暴会击穿单代保证：一次 tsdown pass 重写多个客户端
bundle 时，每个变化的包都会触发一次图重组合（HMR 按 500 ms 间隔轮询每一
行），所以第二次重建就会淘汰第一代。在风暴之前渲染的 index 页面——或在
风暴进行中打开的窗口——随后请求的是该宿主进程已不再提供的 combo URL，
所有 application entry 便激活失败。

## 决策

内容寻址的启动 combo 响应现在按 URL 在宿主进程生命周期内累积（
`retainedBatchResponses`）：combo URL 不可变（`cache-control: immutable`），
且被可能早于多代开发重建的 index 页面引用，所以早期 URL 必须在整个进程
期间保持可应答。bundle 字节不变时反复重组合产生的 URL 是稳定的（哈希是
内容寻址的），因此该 Map 只随不同的内容代际增长，而不是随重建次数增长。
单代的 `previousBatchResponses` 字段已删除；未知或被修改的资源列表、缺少
revision、以及过期的单资源（`invalidate`）revision 仍返回 404——只有启动
combo URL 变为永久可应答。

## 备选方案

保留有界数量的近期代际（例如最近八代）的方案被否决：一次 tsdown pass
重写多个包时，每个变化的包都会触发一次图重组合，任何小环形缓冲都可能被
单次构建风暴击穿；为整场风暴扩大缓冲则成倍占用内存且没有原则性上限——
内容寻址累积只随不同的内容代际增长，并且永远不会淘汰 index 页面仍可能
引用的 URL。

## 后果

宿主进程会保留其发布过的每一个启动 combo 代际，因此当前进程重建历史上
任意时刻的 index 页面都能成功启动；内存随不同的内容代际增长（包 README
的快照式提供限制现在明确说明了这一点）。代价是长时间开发会话中多保留
一些内存，并继续提供磁盘上已不存在的 bundle 内容的 combo URL。desktop
与 web 宿主共用同一 registry，因此两者同时受益。宿主进程重启后仍无法
应答上一进程的 URL——HMR 的 `hostInstance` 帧会通知陈旧标签页刷新，此点
不变。包内套件：84 个测试全部通过（node-half 41 + loader 43）；`tsc -b`
干净。未触及 session-log、snapshot 或 SDK 表面。