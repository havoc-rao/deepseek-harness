# Agent Note: 桌面启动注入保持新鲜、启动审计串行化

Status: implemented

[English](2026-10-02-desktop-boot-injection-staleness.md) | 中文

## 问题

Desktop shell 只采集一次 Web 启动注入——`__DSH_BOOT__` 图、bootstrap 脚本行、每个插件的批量 URL 及其按产物计算的版本号——来源是 Host 的 `ready` IPC 事件，之后每次页面刷新都返回这份快照。应用运行期间插件一旦更新，Host 就会重组图：插件管理器的重载会重挂 loader 行，`client-hmr` 的 stat 轮询会重新发布重建的产物，每次重组都会改变版本号与批量 URL。Host 的 bundle 表只提供当前代加上一代批 URL，以及当前版本号的单资源 URL。

更新后刷新页面，启动用的就是陈旧快照，现场出现过两种失败形态（2026-10-01 的崩溃报告，每次都发生在更新同一插件后一到两分钟内）：

- 陈旧的批 URL 与单资源 URL 已不在 bundle 表中：批脚本 404（`bundle script … failed to load`），每个行回退到自己的单资源 URL，而被更新插件的旧版本号 URL 也已消失，启动审计因此报告 `web boot: N entries did not activate`，附完整 client-modules 诊断。
- 陈旧 URL 仍可提供（快照之后零次或一次重组）：启动导入成功，但页面在启动期间连接 SSE 后立即收到实时图，其版本号与快照不同。协调过程会替换每个刚激活的被更新条目：`tearDownEntryFiber` 先删除 `entry.fiber`，再异步执行重新导入。此前启动审计在 entries 队列之外运行，恰好采样到这种"替换中"状态——条目没有 fiber 也没有记录的导入错误——于是报告 `import failed (see console for the import error)`，而错误级控制台与这次失败毫无关系。

[致命诊断决策](../../architecture/2026-09-22-fatal-diagnostics-and-crash-reports.md)曾把第一种形态记为无法解释的陈旧 URL 404。第二种形态是同一陈旧快照根因加上一次成功的导入：若审计不入队，失败文案会指向一个从未记录过错误日志的控制台。

## 决策

- **Desktop Host 在客户端图重组时重新发布启动注入。** `installInjectionPublisher` 订阅 `clientModules.onGraphChanged`，通过新的 `injections` IPC 事件发送 `ctx.webServer.collectIndexInjections()`——与 Web index 每次调用相同的即时采集。shell 收到后替换缓存的快照；`ready` 事件仍携带首份。此后页面刷新启动时使用的正是 bundle 表当前提供的图，两种失败形态从源头同时消失。没有注册表（或不含它的组合）时保持安静，启动快照仍然作为兜底。
- **启动审计在客户端 entries 队列内运行。** `ClientEntries.audit` 把一个操作串到所有先前入队的协调之后，因此启动期间收到的图帧会完整完成其替换——包括刷新后的条目 fiber——之后 `assertEntriesActive` 才采样 Loader。真正失败的替换仍会把最近一次记录的导入错误留给审计报告；被消除的只有"替换中"的假采样（没有 fiber、没有记录）。

## 考虑过的替代方案

**在 Host bundle 表中保留更多陈旧代。** 有界时间或代数地保留停用版本可以为陈旧快照页面服务，但它掩盖而非修正陈旧快照，且每次更新都占用内存；页面超出保留窗口后失败方式与之前完全相同。对"替换中"的审计采样也毫无作用。

**启动失败时自动刷新一次页面。** shell 缓存仍然陈旧，刷新启动使用的还是同一快照，会再次失败；这个循环只能靠注入刷新来打破。

**在审计前解析队列屏障而不是把审计入队。** 屏障（先 `await this.queue` 再审计）并不能串行化：已入队替换的同步前缀——删除 fiber——在屏障的后续代码运行前就已执行，审计仍可能采样到拆卸窗口。

**把 SSE 图帧推迟到启动审计之后。** 这同样能消除竞态，但会改变每次启动的实时同步时机，还需要处理推迟失败的簿记。把审计入队则保持协调语义不变，并让启动审计报告安定后的恢复状态。

## 验证

| 证据 | 行为 |
|---|---|
| [injections.spec.ts](../../../../apps/desktop-host/tests/injections.spec.ts) | 发布器每次图变化发送一条 `injections` 消息，携带最新注入表；没有客户端模块注册表时保持安静。 |
| [host-process.spec.ts](../../../../apps/desktop/tests/host-process.spec.ts) | `injections` 事件经私有 IPC 送达 shell 回调；畸形负载作为无效事件拒绝 Host。 |
| [boot-client.client.spec.ts](../../../../packages/client/web/tests/boot-client.client.spec.ts) | 启动等待被门控的首个 bundle 时入队一次图替换；审计在替换 bundle 到达前保持未决，随后报告所有条目激活。该测试在审计未串行化时失败。 |
| [main-startup.spec.ts](../../../../apps/desktop/tests/main-startup.spec.ts) | Host 就绪后，启动 IPC 仍以 shell 的注入快照解析。 |

## 后果

- 插件更新后的刷新会基于当前图启动：陈旧版本的 bundle 404 与"替换中"的 `see console` 审计消失。
- 启动期间到达的图帧最多把启动审计推迟到替换下载完成；失败的替换仍以最近记录的导入错误响亮报告。
- Web 变体本就按请求采集注入，新增的是串行化审计；只有 Desktop shell 存在陈旧快照。
- 桌面 shell 只在 Host 运行期间刷新注入；替换的新 Host 会在自己的 `ready` 事件上重建快照。
