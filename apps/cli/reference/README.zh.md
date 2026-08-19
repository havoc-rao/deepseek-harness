# `dsh` CLI（命令行界面）行为参考

[English](README.md) | 中文

本参考定义 profile 启动、web 别名、插件管理和配置 dump 等命令模式。argv 由 [`src/args.ts`](../src/args.ts) 统一解析一次，[`src/bin.ts`](../src/bin.ts) 只会动态导入选中的运行器。

## Profile 启动

`dsh --profile <name>` 启动位于 `$DSH_HOME/profiles/<name>` 的 profile。生效配置树以空根节点为起点，依次叠加 profile manifest（元数据清单）的 `dsh.profile.bundles` 列表中指定的各组合包 patch、profile 自身的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml`（这是各 profile 共享的机器本地偏好，因此优先于逐 profile 配置层），以及按 argv 顺序指定的各个 `--patch <path>` 覆盖层。对同一配置行，后应用的层优先。patch 会替换目标行的整个 `config` 值，而不是深度合并其中的键；patch 也可以插入新行。配置解析、schema 校验、模块解析或插件启动失败时，系统会报告错误并以非零状态退出。收到 SIGINT 或 SIGTERM 时，挂载的根节点会先 dispose（资源释放）再退出。

组合包名称先从 dsh 安装目录解析，再从 profile 目录解析。因此，内置组合包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`）始终来自当前运行的 `dsh` 所属的安装；树外组合包则来自 profile 中由 pnpm 管理的 `node_modules`。patch 行中的裸插件 `name` 会从 profile 目录开始，按照 Node 的模块解析规则逐级向父目录查找，直至由 dsh 维护的安装后备目录 `$DSH_HOME/profiles/node_modules`。该目录为 dsh 安装中的应用和组合包所依赖的每个包各维护一个符号链接，并在每次启动时修复这些链接。

`web` 和 `headless` profile 首次使用时会从随附模板自动初始化（`web`：base + web-app；`headless`：base + headless）。其他缺失的 profile 会显式报错，并提示运行 `dsh plugin --profile <name> add <package>`。

### 应用参数

启动器自身的 flag 必须写在最前面，并在遇到第一个无法识别的 token 时结束；从该 token 开始的所有内容都会通过 `ctx.cmdlineArgs` 原样交给已启动的 profile，注入该 profile 的任意应用插件都可以解析这些内容（[`dsh-cmdline`](../../../packages/boot/cmdline/README.md)）。因此，`dsh --profile web --port 8080` 会将 `--port` 交给 web 应用；`dsh --profile web --help` 只打印该应用的帮助信息，不启动应用；`dsh --help` 没有可供交付参数的 profile，因此会打印启动器自身的帮助信息。`-V`/`--version` 位于应用参数边界之前时，会打印启动器的版本。

每套组合只会挂载一次。普通插件注入 `cmdlineArgs`，解析所属应用的参数，并将解析结果作为服务提供。每个从 flag 取值的配置行都会注入该服务；Loader 会等到服务激活后，再对该行的配置求值（`port: !!js ctx.webStartup.port ?? 3080`），因此 flag 的优先级高于配置行中写明的值。要维持这一优先级，配置行必须保留该表达式；如果用户 patch 用字面量替换整个 `config`，也会随之移除运行时读取。帮助参数和被拒绝的参数都会请求退出：参数被拒绝时以非零状态退出，显示帮助时以 0 退出；依赖该提供方服务的配置行不会激活。在线编辑 `cordis.patch.yml` 时，系统会根据仍在运行的服务重新计算表达式，因此不会重置当前正在使用的端口。

启动器的 flag 必须写在应用参数之前，且启动器的解析器会消耗掉一个 `--`：必须以字面量 `--` 送达应用的参数需要写成 `-- --`。如果应用的第一个参数恰好等于 `web` 或 `plugin`，会选择对应的子命令。`ctx.cmdlineArgs.get()` 是共享的不可变读取：多个插件可以解析同一份快照，没有读取方的 profile 则会忽略自己的应用参数。

随附的应用接受以下命令行参数：

| Profile | 参数 |
|---|---|
| `web` | `--host`、`--port`、可重复的 `--trusted-host` |
| `headless` | 任务文本，作为位置参数 |

一次性任务（`dsh --profile headless "run the tests"`）通过核心注册表创建一个全新的持久化 Agent（智能体），提交任务、等待完全停稳并对会话执行 flush，再从其持久化事件区间中推导最后一个非空 assistant 文本与最终 `turn/end` 原因。它在 stdout 打印文本，并在原因为 `completed` 时以 0 退出，否则以 1 退出。没有任务的调用是该应用的用法错误。随附 headless profile 不挂载 ApiProxy、Host、HTTP 服务器、Web 运行时或浏览器客户端；成功运行不会向 stderr 写入任何内容，也不会打开监听端口。

可在不启动的情况下检查组合出的配置树：

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` 只打印组合包各层；`--dump-config` 额外加上 profile 的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml` 和 `--patch` overlay。两者都会打印注释，标明每行由哪个文件提供，以及哪些 overlay 修改过它；`!!js` 表达式保持未求值，找不到目标的 patch 会报告到 stderr。dump 操作不会运行应用的命令行参数提供方，因此展示的是解析任何应用参数之前的组合配置树；如果调用中包含应用参数，dump 会拒绝该调用。

## 插件管理

`dsh plugin --profile <name> <args...>` 在 profile 缺失时先初始化它（有随附模板的用模板，其他名称只装 `@deepseek-ai/dsh-base`），然后以 profile 目录为工作目录，把 `<args...>` 转发给 `pnpm`：`add`、`remove`、`why`、`update` 及其他所有 pnpm 子命令都照常可用；pnpm 必须在 PATH 上。相对路径 spec（`.`、`../plugin` 及其 `file:`/`link:` 形式）会先锚定到调用目录，因此在插件 checkout 中执行 `add .` 安装的是该 checkout，而不是 profile。每次成功运行后，系统都会根据当前安装状态更新 `dsh.profile.bundles`：如果某项依赖解析到的包在 manifest 中声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，该依赖就会加入配置层栈；如果某项依赖在 `update` 后获得该声明，也会随即激活。没有组合包声明的依赖仍作为普通依赖保留，并显示一次性警告；已移除的依赖则从配置层栈中删除。

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

随源码发布的 Git 托管插件会在安装期间通过 `prepare` 脚本构建，而 pnpm ≥10 默认会阻止该脚本，直到使用方明确允许。首次运行 `add` 会失败，并显示 pnpm 的 `allowBuilds` 提示；dsh 还会提示应修改该 profile 的 `pnpm-workspace.yaml`。将输出的键复制到该文件后，重新运行命令即可。安装已经构建好的 tarball 或本地 checkout 时，无需加入 `allowBuilds`。

### 启用和停用某一行

`dsh plugin --profile <name> list` 打印 profile 组合树（组合包层、profile 自身的 `cordis.patch.yml`、home 级 `$DSH_HOME/cordis.patch.yml`）中的每一行及其 entry id 与有效状态——`enabled`、`disabled`，或当该行由 `!!js` 值控制时显示为 `expression`。该列表是只读的，无法组合树时显式报错；这是查找 `--dump-config` 所示 id 的专门手段。

`dsh plugin --profile <name> disable <row>` 和 `enable <row>` 通过编辑 profile 自身的 `cordis.patch.yml` 来切换某一行加载器配置的 `disabled` 标志——这正是启动时组合所读取的用户配置层，长驻界面会热重载它，因此在运行的 web/Electron 应用上无需重启即可生效。行可以用组合树中的 entry id 指定；当没有行携带该 id 时，按 `name` 查找——例如组合包以 `name: dsh-better-sidebar`、`id: better-sidebar` 插入的行，两种写法都能命中，补丁会写入该行真实的 id，此前按字面 id 写入的失效条目会被丢弃而不是叠加。无法组合的 profile 会回退到字面 id。与所有 `dsh plugin` 动词一样，缺失的 profile 会先被初始化。

`disable` 为该行写入 `disabled: true`：行不存在时创建补丁条目，若原本由 `!!js` 表达式控制则替换为字面量 `true`。`enable` 移除该行的 `disabled` 覆盖，恢复该行声明的默认状态，而不是强制打开；若条目只剩 `id` 键则整体删除，因此 disable→enable 的循环不会在文件中留下残留。两个动词都幂等，且编辑以 YAML AST 方式进行——手写注释、格式以及无关的 `!!js` 表达式节点都会保留。

由于开关只编辑 profile 自身那一层，`enable` 之后，下层（组合包或 home 级 `$DSH_HOME/cordis.patch.yml`）的 `disabled: true` 仍然生效；命令会在编辑后（免启动、尽力而为）重新组合配置树，并在该行仍然关闭时给出警告——要强制打开，需要在 profile 层手写 `disabled: false`。若没有组合行携带该行名称，命令会给出警告，因此拼写错误不会静默写入无效补丁；无法组合的 profile（例如组合包损坏）仍然接受开关操作，因为停用某行正是用户在配置树损坏时会做的事。

```sh
dsh plugin --profile web list
dsh plugin --profile web disable dsh-better-sidebar
dsh plugin --profile web enable dsh-better-sidebar
```

## Web GUI 启动器

`dsh web` 是一个 pid 启动器：裸命令会把 `dsh --profile web` 重新启动为后台进程——复用当前进程运行所用的同一套启动器（因此 `--import tsx` 的源码启动与构建产物启动保持一致），把 pid 记录到 `$DSH_HOME/web.pid`、服务器的输出追加到 `$DSH_HOME/web.log`，等待 web 应用的就绪行（最长 15s）并把 URL 打印到终端后才返回。`dsh web stop` 读取 pid 并按共享的 SIGTERM-then-SIGKILL 协议停止；在服务器运行时再次执行 `dsh web`，会在报错信息旁一并打印运行中实例的 URL。web 应用自己的 flag——`--host`、`--port`、可重复的 `--trusted-host`——跟在命令之后并原样转发；`--patch` 覆盖配置也会送达重新启动的 boot。

```sh
dsh web                              # 后台启动（pid + 日志在 $DSH_HOME 下）
dsh web --patch ./extra.cordis.yml   # 给重新启动的服务器带上覆盖配置
dsh web --port 8080                  # app 参数转发给重新启动的服务器
dsh web stop                         # SIGTERM，3s 后升级为 SIGKILL，然后移除 pid 文件
dsh web --dev                        # 前台启动：经典的进程内 profile boot，Ctrl+C 就地销毁整棵树
dsh web --dev --port 8080            # --dev 是 launcher 自己的开关，不会转发给 app
dsh web --help                       # web 应用自身的帮助仍以前台方式打印并退出
```

`--dev` 是 launcher 自己的前台开关：它像 `--profile web` 一直做的那样在本进程内启动 profile，因此 URL 行直接落在终端上，Ctrl+C 就地销毁整棵树。配置转储（`--dump-config`/`--dump-default-config`）保持不启动，并优先于所有动作。

生产 Web 运行器需要已构建的包和前端产物（`pnpm run build`）。默认服务地址是 `http://127.0.0.1:3080`。CLI 目前有意不支持 `--host 0.0.0.0`，并会以用法错误退出；`--trusted-host` 可添加 `/api` 浏览器信任围栏接受的具名 authority。

## Electron 桌面应用

`dsh electron` 管理共享 `web` profile 之上的 Electron 桌面壳——`dsh web` 是在进程内启动同一个 profile。启动器保持解析器角色：它找到仓库内的 `@deepseek-ai/dsh-electron` 包（在存储库布局中，它位于 `apps/cli` 旁边的目录）以及其 devDependencies 安装的 `electron` 二进制（electron 包的 `path.txt` 指向它，因此 pnpm store 布局和 hoisted 的 node_modules 皆可解析），把派生的 pid 记录到 `$DSH_HOME/electron.pid`，把应用的输出追加到 `$DSH_HOME/electron.log`，然后立即返回——窗口运行期间 shell 仍可用：

```sh
dsh electron                     # launch detached (alias of the start action)
dsh electron start --dev          # explicit start; --dev reaches the Electron main process
dsh electron stop                 # SIGTERM, escalation to SIGKILL after 3s, then remove the pid file
dsh electron log                  # tail -f the app log (latest 100 lines first)
dsh electron log -n 500           # tail -f with more history
```

`stop` 读取记录的 pid，先发送优雅的 `SIGTERM`，三秒宽限期后升级为 `SIGKILL`，再移除 pid 文件；过期 pid（进程早已不在）会被静默清理。已有实例存活时再次 `start` 会 fail loud，而不是叠出第二个窗口。应用自身的 main 文件会在窗口内启动 `web` profile，因此浏览器与桌面界面共享同一个请求到的插件树；该树上没有任何东西存活在启动器进程中。

桌面应用不新增任何启动器 flag：profile 层仍来自同一个 `$DSH_HOME/profiles/web` 配置栈，`webserver`/`web-runtime` 两行则由应用自身的 `config/electron.patch.yml` 覆盖（loopback host、OS 分配端口、URL 行和 surface persona 关闭）。由于桌面应用包是私有且未发布的，`dsh electron` 仅限仓库内使用；没有桌面包的已安装 `dsh` 会以缺少包的明确消息 fail loud，而不是静默 no-op。在无 POSIX `tail` 的系统上，`dsh electron log` 会报告缺少该工具，而不是吞掉请求。

进程关闭时，插件树最多有 5 秒完成 dispose。首次收到 `SIGINT` 或 `SIGTERM` 时会开始优雅排空：`SIGTERM` 是监督进程发出的常规停止请求，在所有运行模式下都以 0 退出；`SIGINT` 则报告 130。第二次收到信号时会立即强制退出。如果一次性运行在正常结束时已经卡在 dispose 阶段，第一次按下 `Ctrl+C` 就会直接升级为强制退出，而不会被忽略。

所有模式都将运行命令时所在的目录作为默认 workspace 根目录，以 65,536 字节渲染预算加载适用的 `AGENTS.md` 或 `CLAUDE.md` 指令，并使用内存 SQLite 会话内容索引。每次启动 profile 时，系统都会监视 profile 与 home 两个 `cordis.patch.yml` 配置层的有效变更，并以事务方式重新应用；一次性运行模式通过有界关闭流程退出，该流程会先 dispose 监视器。

新会话默认使用 `workspace-write` 权限预设。Bash 和文件系统修改仅限于会话 workspace 与平台临时根目录；读取、网络访问和进程可见性不受限制。`DSH_PERMISSION_MODE` 更改进程后备值。General settings 中存储的权限影响后续 Web 会话，不改变已打开的会话。

`DSH_TOOLS_MODE` 为进程选择 `native`、`code` 或 `both`；其他值会导致启动失败。随附的 `minimal` agent preset 会保留该部署的呈现方式，将完整系统提示词固定为 `You are a helpful software engineer assistant.`，并且仅组合持久 `bash` 和 `str_replace_editor`。创建 Web 会话时请选择极简模式；该 agent 不包含任何其他提示词段落或面向模型的插件，而共享的浏览器、workspace、持久化、沙箱与权限宿主保持不变。

## 共享部署行为

基础组合包挂载原生 DeepSeek 适配器、settings 与凭据提供方、稳定的 `web_search` 和已禁用的会话遥测。提供方凭据依次从继承环境、`$DSH_HOME/.credentials.yaml`、调用目录的 `.env` 和 `$DSH_HOME/.env` 解析；受管文档从不物化进 `process.env`，而两个 `.env` 文件都是普通启动环境层。搜索使用 `DEEPSEEK_API_KEY` 并接受 `DEEPSEEK_SEARCH_BASE_URL`；只有 patch 层插入提供方并启用 `web_fetch` 后，该工具才可用。

会话遥测默认留在本地。`DSH_TELEMETRY_MODE=FULL` 将每条已投影会话事件作为 OTLP/HTTP 日志流式发送，`DSH_TELEMETRY_MODE=FEEDBACK_ONLY` 则仅在记录反馈时上传会话日志后缀。`DSH_TELEMETRY_OTLP_URL` 选择其他 collector。任何非空的 `DSH_TELEMETRY_DISABLED` 都是具有最终效力的遥测强制关闭开关。随附基础配置没有遥测脱敏规则，因此显式启用的导出可能包含消息文本、工具参数和结果，以及 workspace 路径；相关部署决策见[默认关闭 Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md)。

通过 `dsh plugin --profile <name> add <package-or-git-spec>` 安装外部插件组合包。安装的包拥有其依赖，并贡献其声明的 `cordis.patch.yml` 层。CLI 还随附 `@deepseek-ai/dsh-mcp-client` 作为供 patch 层使用的依赖，但默认不启用 MCP 服务器，因为每条服务器命令都是 agent（智能体）沙箱之外的受信任可执行代码。

## 源码执行

请在仓库根目录中，于全新 checkout 之后及产物需要更新时单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>`。`package.json` 中的脚本不会构建，而是通过 `node --import tsx/esm` 启动 `apps/cli/src/bin.ts`，并转发所有参数。Typert Host 产物缺失时，profile 启动会因不含构建指引的模块解析错误而失败。这些 Host 产物存在后，如果前端或 Client plugin 组合包缺失，启动会失败并提示运行 `pnpm run build`。启动器不会检查产物是否为最新，因此已有的陈旧组合包可能继续运行旧版浏览器代码，直至重新构建。该进程会继承启动环境；当支持环境代理的 Node 版本必须遵循 `HTTP_PROXY` 和 `HTTPS_PROXY` 时，请设置 `NODE_USE_ENV_PROXY=1`。安装形式会直接启动构建后的 `apps/cli/lib/bin.js`，不会重新构建仓库。
