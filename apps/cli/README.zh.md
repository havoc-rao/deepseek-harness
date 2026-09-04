# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是 DeepSeek Harness 中用于启动 profile 的命令；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh web` | 后台启动 Web GUI（pid 与日志在 `$DSH_HOME` 下）；`dsh web stop` 停止它。`dsh web --dev` 则改为前台启动。 |
| `dsh electron` | 后台启动仓库内的 Electron 桌面应用（共享 `web` profile 的桌面壳）；`dsh electron stop` 停止它，`dsh electron restart` 派发一次分离式重启（任意 pid 文件状态下都可用），`dsh electron log` 跟踪它的日志。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |
| `dsh plugin --profile <name> list` | 打印 profile 组合后的各行及其 entry id 与状态。 |
| `dsh plugin --profile <name> enable\|disable <row>` | 在 profile 的 `cordis.patch.yml` 中切换某一行配置的 `disabled` 标志。 |
| `dsh update --profile <name> [--install] [pkg...]` | 原位重建 profile 中以 `link:` 安装的插件，依次执行每个插件自身的构建脚本。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## Web GUI

```sh
dsh web                          # launch detached: pid + log under $DSH_HOME (http://127.0.0.1:3080 by default)
dsh web --port 8080              # forwards app flags to the relaunched server
dsh web stop                     # SIGTERM the running server (escalates to SIGKILL after a grace period)
dsh web --dev                    # foreground boot: the pre-launcher in-process profile boot, Ctrl+C disposes the tree
```

裸命令会把 `dsh --profile web` 重新启动为后台进程（复用当前进程所用的启动器，因此源码启动与构建产物启动保持一致），把 pid 记录到 `$DSH_HOME/web.pid`、输出追加到 `$DSH_HOME/web.log`，然后等待服务器就绪行（最长 15s）并打印 URL——服务器运行期间 shell 仍可用：

```sh
$ dsh web --port 0
dsh: web started (pid 10289); log: /Users/havoc420/.dsh/web.log
dsh web: http://127.0.0.1:64339
```

`web stop` 读取 pid 并按共享的 SIGTERM-then-SIGKILL 协议停止。`--dev` 是 launcher 自己的前台开关，不会转发给 app；它之后的参数（或任一未知 token 之后的参数）属于 web 应用，由其自身打印 `--help`。

## 更新 link 插件

`dsh update` 重建 profile 中通过 `link:`/`file:` 依赖的树外插件（pnpm 链接的是实时 checkout，因此刷新 profile 意味着重建该 checkout 的构建产物，而非重新安装任何东西）。它会在插件的 checkout 目录中依次执行每个插件自身的 `build` 脚本——当包未声明 build 步骤时回退到 `prepare`：

```sh
dsh update                                  # list every linked plugin across all profiles and pick
dsh update --profile web                    # rebuild every linked plugin in that profile
dsh update --profile web dsh-better-sidebar # rebuild just that plugin
dsh update --profile web --install          # pnpm install first (after dependency changes)
```

不带 `--profile` 时，`dsh update` 会扫描 `$DSH_HOME/profiles`，打印每个 link 插件（带编号）及其 git 状态（`main ↓2 ↑1 ✖` 表示远端领先 2 个提交未拉取、本地 1 个提交未推送、工作区有改动），然后提示选择要重建的插件——输入为空表示全部，输入 `q` 退出。每个 git checkout 在列出前会先只读 fetch，确保状态是最新的。非交互场景（无 TTY）下会打印列表并要求显式指定 `--profile`。

- `--pull` 会在构建前对每个选中的 checkout 执行 `git pull --ff-only`：只允许快进，遇到本地提交或未提交改动会拒绝合并并报错。与 `--install` 组合即完整同步：远端代码 + 依赖 + 重建产物。
- 以 registry 版本安装的插件或没有 `.git` 的 checkout 没有可 fetch/pull 的远端，按纯本地处理：`--pull` 跳过但照常重建。

更新后需要重启 `dsh web`：配置 patch 支持热更新，而打包后的模块产物不会。

## 切换插件开关

`dsh plugin list` 会打印 profile 组合树中的每一行及其 entry id 与状态，便于在切换前先看清某行叫什么：

```sh
dsh plugin --profile web list
```

`dsh plugin disable` 和 `dsh plugin enable` 会通过编辑 profile 的 `cordis.patch.yml` 中对应行的 `disabled` 标志来打开或关闭某个加载器行——这正是启动时组合配置所读取的文件，且 web、Electron 等长驻界面会热重载它，因此在运行中的应用上切换开关无需重启：

```sh
dsh plugin --profile web disable dsh-better-sidebar   # writes disabled: true for that row
dsh plugin --profile web enable dsh-better-sidebar    # removes the override again
```

行可以用组合树中的 entry id 指定；当没有行携带该 id 时，也可以用行的 `name` 指定——例如组合包以 `name: dsh-better-sidebar`、`id: better-sidebar` 插入的行，两种写法都能命中，补丁会写入该行真实的 id（此前按字面 id 写入的失效条目会被清理）。`dsh plugin --profile web list` 会列出所有 id。`disable` 写入 `disabled: true`（行不存在时创建补丁条目；若该行原本由 `!!js` 表达式控制，则替换为字面量 `true`）。`enable` 移除该覆盖——恢复该行声明的默认状态——若条目只剩 `id` 键则整体删除。两个命令都幂等，且都会保留文件上手写的注释和其他 `!!js` 表达式。

下层（组合包或 home 级 `$DSH_HOME/cordis.patch.yml`）的 `disabled: true` 在 `enable` 之后仍然生效，因为此命令只编辑 profile 自身那一层；当组合后的行仍然关闭时命令会给出警告，此时如需强制打开，需手写 `disabled: false`。id 拼写错误时，命令会提示组合树中没有对应行。

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.zh.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.zh.md)为准。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
