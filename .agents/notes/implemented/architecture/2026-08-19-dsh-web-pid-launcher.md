# `dsh web` 改为 pid 启动器，`--dev` 保留前台 boot

日期：2026-08-19

## 变更

`apps/cli` 的 `dsh web` 语义从前台 `--profile web` 别名改为 **pid 启动器**：裸命令把 `dsh --profile web <args>` 重新启动为 detached 后台进程，pid 记到 `$DSH_HOME/web.pid`，输出追加 `$DSH_HOME/web.log`，立即返回终端。`dsh web stop` 走 SIGTERM→SIGKILL 协议（复用 electron 的 stop 逻辑）。**`dsh web --dev` 才是前台 boot**（旧的进程内启动，Ctrl+C 就地 dispose）——launcher 自己解析并剥离 `--dev`，不转发给 web app。

## 关键设计

- **启动器复用**（`src/web.ts` `resolveWebLauncher`）：子进程 = 当前进程的 `process.execPath` + `argv[1]`（入口脚本）+ loader 开关。dev 场景 `node --import tsx src/bin.ts` 下必须**成对转发** `--import tsx`，否则子进程原生 node 无法加载 `.ts` 源码（实测 `bad option: --profile`：`--import` 会吃掉下一个参数，所以 loader 必须 开关+取值 一起收集）。built-bin（lib）场景无 loader。
- **共享 daemon 协议**（`src/daemon.ts` 新建）：`daemonStateFiles`/`readPid`/`isPidAlive`/`stopDaemon` 从 electron.ts 抽出，electron 与 web 共用；`stopDaemon` 支持注入 stdout/stderr（测试）。
- **URL 就绪判定**：web-app bundle 的 `dsh web: http://…` 行只出现在子进程日志里，监督者据此轮询就绪（scripts/publish-npm-baseline、web e2e 均改用 `--dev` 前台跑以便读 stdout）。
- **args.ts**：`web` 子命令的动作顺序 = dump（保持不启动）> `stop` > `--dev`/`-h`（转前台 profile boot）> 裸命令（pid 启动器）。`stop` 带多余参数报错。
- **进程语义**：前台 `--dev` 与后台启动完全等价（同一 profile boot 路径）；停机 `web stop` 发给会话进程 SIGTERM → profile-boot 的既有 disposer 优雅收树。旧代码留下的 `web.pid` 不存在时 `stop` 报 "nothing to stop"。

## 受影响消费者（全部迁移到 `--dev` 保持前台语义）

- `apps/cli/tests/lazy-search-startup.compat.spec.ts`（built web probe）
- `apps/cli/tests/built-bin.e2e.ts`（`--host 0.0.0.0` 拒绝路径）
- `apps/web/tests/smoke-real.e2e.ts`、`hmr-live.e2e.ts`（spawn 加 `--dev`）
- `scripts/publish-npm-baseline.ts`（POSIX python 探针）

## 测试

`apps/cli/tests/web.spec.ts`（新建，31 项含 args/electron 全绿）：fake launcher 用 shebang 二进制（`#!node` + chmod）避免 vitest forks 池对 `spawn(node, [script])` 的干扰——本机 CodeBuddy shim + vitest 组合会把经 node 的 JS 子进程重定向到 vitest worker 入口（`init-forks`）；二进制和 electron.spec 一致的安全形状。