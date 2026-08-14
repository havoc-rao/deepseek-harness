# 模块 07 — 文档与门禁

**状态：⬜ 待办**（前置：06）

## 目标

补齐架构文档与 Agent Note，完善测试覆盖，跑通全部门禁，让本次改动可评审、可合入。

## 范围

- `docs/architecture.md`：terminal 能力 seam（host 插件 + client 插件 + 共享协议）。
- Agent Note（`.agents/notes/`，随 PR 提交，归档后冻结）。
- 单元/集成测试补齐。
- 门禁：typecheck / lint / build / test。
- **不做**：改动既有插件行为、非本任务范围的文档。

## 实施步骤

- [ ] **架构文档**：`docs/architecture.md` 补充 capability seam 描述——
  - host 侧：`dsh-host-terminal-web` 在 `/api/terminals` 挂 upgrade + browser-trust fence，桥接 `ctx.subprocess.spawnTerminal`；明确「不碰 `ctx.terminals`，UI 直连不走 owner-scoped 注册表」的边界理由。
  - client 侧：`dsh-client-ui-terminal` 注册 `shell.overlay`（additive），xterm 渲染 + WS 帧通道。
  - 共享协议包 `dsh-terminal-protocol`：帧契约（opcode 表、小端、维度上限），双端共用。
  - 数据流：Browser → WS 帧 → upgrade → TerminalSocket → node-pty；反向 output 流 → Output 帧 → xterm。
- [ ] **Agent Note**：`.agents/notes/implemented/` 下新建（或按仓库 note 规范），记录关键决策：复用 PTY 栈不引新依赖、一个 socket = 一个 PTY 生命周期（断开重起不持久化）、私有 API 版本锁、WebGL 恢复预算、背压阈值两端一致。
- [ ] **测试补齐**：
  - host：`terminal-socket.spec.ts` 已覆盖生命周期；补 upgrade 路径（fence 拒绝非 trusted host）。
  - client：TerminalView 装配/卸载清理（vitest + jsdom）、useTerminalSocket 帧分发/重连/背压水位、useTerminalLayout 节流。
  - 共享协议已有单测，改协议时同步。
- [ ] **门禁**：`pnpm run typecheck` → `pnpm run lint` → `pnpm run build` → `pnpm run test` 全绿。
- [ ] 手动端到端复验（模块 04–06 验收项各过一遍）。

## 验收标准

- [ ] `docs/architecture.md` 通过 doc 相关门禁（如 `pnpm run doc-sync` 涉及则跑）。
- [ ] Agent Note 与实现一致、无过时陈述，归档策略符合 `.agents/notes/README.md`。
- [ ] 新增测试覆盖：upgrade fence、帧分发、重连、背压、布局节流。
- [ ] 四项门禁全绿；git diff 干净（无临时文件、无调试残留）。

## 风险与注意

- **Note 归档冻结**：归档后不可再改；如有新决策另起 note。
- **测试不伪造行为**：测试描述行为而非正确性；变更行为要同步改测试并说明原因。
- **门禁不默认全量**：按仓库规范跑相关命令即可，CI 负责全量矩阵；仅跨仓库改动时考虑全量复演。
