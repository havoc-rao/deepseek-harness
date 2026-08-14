# 模块 03 — client 插件骨架 `dsh-client-ui-terminal`

**状态：✅ 已完成**

## 目标

建立 client 插件包，把终端面板挂到 `shell.overlay` list slot（AppFrame 已渲染该浮层层，additive），并追加 web roster 两行。本模块只求面板出现，交互闭环在模块 04 打通。

## 范围

- 新建 `packages/client/ui-terminal/` 包（`@deepseek-ai/dsh-client-ui-terminal`）。
- `packages/bundle/web-app/cordis.patch.yml`：insert 段追加两行（client `ui-terminal` + host `terminal-web`）。
- **不做**：xterm 实例与 WS 逻辑（模块 04）、丝滑优化（模块 05/06）。

## 关键参考模式（已确认）

- **slot 注册**（仿 ui-goal/ui-tool）：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'terminal', locale: NS }, TerminalPane))`。
- **`shell.overlay` 声明**：ui-layout 在 `ctx.slots.register({ name: 'root', children: { ..., 'shell.overlay': { kind: 'list', scope: 'root' } } }, AppFrame)` 声明，AppFrame 在 `.overlayLayer` div 里 `renderSlot('shell.overlay', {})`。注册方只增不改。
- **clientBundle**：`tsdown.config.ts` 用 `clientBundle('@deepseek-ai/dsh-client-ui-terminal', ['lib/types/index.js'])`（import `../tsdown.client.ts`）。
- **roster 格式**：`- id: ui-terminal\n  name: '@deepseek-ai/dsh-client-ui-terminal'`，追加在既有 client 行（如 `ui-layout`）之后；host 行 `terminal-web` 追加在 host 行区（如 `webserver` 之后）。同 insert 段内顺序即组合顺序，不改既有行。
- **CSS 契约**：样式必须 `*.module.css`（lightningcss 内联 + `<style data-plugin>` 注入）。

## 实施步骤

- [x] `package.json`：`"type": "module"`；deps `@xterm/xterm@^5.5.0`、`@xterm/addon-fit`、`@xterm/addon-webgl`、`@xterm/addon-canvas`（作为普通 dependency 被 noExternal inline 进 client bundle，无需改 apps/web / PLATFORM_MODULES）；peerDeps cordis / client-slots（/ ui-layout 仅类型引用则 optional）。`dsh.client` 声明。
- [x] `tsconfig.json` + `tsdown.config.ts`（参照 ui-layout：`clientBundle(...)`）。
- [x] `src/index.ts`（node half）：client 插件元数据/扫描入口，可为空 `apply`。
- [x] `src/client/index.ts`：`ctx.slots.inject('shell.overlay', ...)` 注册 `TerminalPane`；面板开关状态（初始关闭，预留 `/terminal` 命令或工具条开关触发）。
- [x] `src/client/TerminalPane.tsx`：空面板外壳——圆角浮层 + 顶部细工具条（标题「终端」、会话状态点、关闭按钮）+ 终端挂载区 + Tailwind 样式。
- [x] `packages/bundle/web-app/cordis.patch.yml`：追加两行（client `ui-terminal` + host `terminal-web`）。
- [x] `pnpm install` + `pnpm run build`（tsc 通过；tsdown 产出 `lib/index.js` + `lib/invariant.js` + `lib/client.js` 6.40 kB）。
- [x] 页面验证空面板出现（roster 两行无加载错误 + 触发开关面板出现可关闭）。实测：`pnpm dsh --profile web --port 3080` 启动，浏览器打开 http://127.0.0.1:3080 无 console 错误；点击「终端」开关出现 `shell.overlay` 浮层（标题「终端」+ 关闭按钮 × + 占位「终端会话将在此处运行」），点击关闭后面板消失。host face 因模块 02/04 测试遗留 tsc 错误阻塞全量 build，单独 `tsdown --env.DSH_BUILD_FACE host` 补齐 `terminal-protocol`/`terminal-web` bundle 后启动验证。

## 验收标准

- [x] 页面加载后 roster 含两个新行，无加载错误（浏览器 console 0 errors / 0 warnings，服务器日志干净）。
- [x] 触发面板打开后，`shell.overlay` 浮层出现空终端面板，可关闭。
- [x] `pnpm run typecheck` / `pnpm run lint` 通过（`tsc -b` 通过；oxlint 0 warnings / 0 errors）。

## 风险与注意

- **爆炸半径**：不 replace 既有 overlay entries，只 add。不 import 官方 `xterm.css`（自写样式，见模块 06）。
- **xterm 锁 `^5.5.0`**：后续用到 `_renderRows`/`_core` 私有 API，版本升级需 patch 测试。
- **TERM 环境**：subprocess `name:'dumb'` 限制颜色，spawn spec `env` 里建议 `TERM: 'xterm-256color'` 覆盖。
