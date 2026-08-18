# Agent Note: `dsh plugin enable|disable` 条目开关

Status: implemented

[English](2026-08-18-dsh-plugin-toggle.md) | 中文

## 问题

profile 的插件树由 patch 层组合而成，某一行的 `disabled` 标志正是打开或关闭某个插件的开关。在此之前，切换这个开关只能手动编辑 `$DSH_HOME/profiles/<name>/cordis.patch.yml`（或 home 级 patch）并依赖热重载，或者通过 `dsh plugin --profile <name> remove <package>` 彻底卸载插件——后者会破坏 profile 的组合包依赖，而不是切换某一行。`dsh plugin` 此前只有安装/卸载动词，没有启停动词，因此用户问"怎么关掉这个插件"时，命令行没有答案。

## 决策

**在 `apps/cli` 的现有 `dsh plugin` 命令上新增 `dsh plugin --profile <name> enable|disable|list`**（`src/plugin-entries.ts`）几个被拦截的动词：

- `list` 打印 profile 组合树中的每一行及其 entry id 与有效状态（`enabled`、`disabled`，`!!js` 控制的显示为 `expression`）；只读，无法组合树时显式报错。
- `disable <row>` 为该行的 entry id 向 profile 自身的 `cordis.patch.yml` 写入 `disabled: true`：行不存在时创建补丁条目，若原本由 `!!js` 表达式控制则替换为字面量 `true`。
- `enable <row>` 移除该行的 `disabled` 覆盖，恢复该行声明的默认状态，而不是强制打开；若条目只剩 `id` 键则整体删除，因此 disable→enable 的循环不会在文件中留下残留。
- 行可以用 entry id 指定；当没有组合行携带该 id 时，按 `name` 解析（组合包以 `name: dsh-better-sidebar`、`id: better-sidebar` 插入的行两种写法都能命中），且同一次调用解析到不同 id 时，之前按字面 id 写入的裸条目会被丢弃。无法组合的 profile 会回退到字面 id——停用某行正是用户在配置树损坏时会做的事。
- 两个开关动词都幂等，且所有编辑都以 `yaml` v2 AST 方式应用（`@deepseek-ai/dsh` 新增的直接依赖），而不是从解析后的对象重新序列化：手写注释、格式以及无关的 `!!js` 表达式节点都会保留。选择 `yaml` 而非已有的 `js-yaml`，是因为 include schema 的 `js-yaml` 往返会丢弃注释并重排整个文件——那会在每次开关操作时重写用户手动编辑过的配置层。
- 编辑后命令会（免启动、尽力而为地）通过 `loadProfile`/`composeEntries` 重新组合配置树（组合包层 + profile 层 + home 层），并在 `enable` 后该行仍被下层停用、或该行在组合树中没有对应时给出警告。组合失败绝不能阻止开关操作。
- 开关写入的是 profile 的 patch 层，而长驻界面（web、Electron）会通过 `watchUserPatches` 热重载该文件，因此 CLI 开关无需重启即可作用于正在运行的应用。与其他 `dsh plugin` 动词一样，缺失的 profile 会先被初始化。

语法改动是位置拦截：`--profile` 之后的第一个 token 若为 `list`/`ls`、`enable` 或 `disable`，则路由到 profile-entries 运行器（`list` 不接受参数；开关动词要求恰好一个行名）；其余动词仍然原样转发给 pnpm。

## 考虑的替代方案

**新增带独立 `--profile` 要求的 `dsh plugin enable/disable` 子命令。** 被拒绝：现有语法把 `--profile` 放在父级 `plugin` 命令上，并拒绝子命令携带父级选项；若将动词做成子命令，就不得不写成 `dsh plugin enable --profile <name> <id>`，破坏 `add`/`remove` 确立的 `dsh plugin --profile <name> <动词>` 形态。

**让 `enable` 写入 `disabled: false` 以强制打开。** 被拒绝：profile 的 patch 层是一个用户覆盖栈；写入 `false` 会夺取下层组合包的控制权，并在每次 disable→enable 循环后留下一个永久的空操作条目。移除覆盖表达的是"恢复声明的默认状态"，且保持文件干净；强制打开被下层停用的行仍是一行手写改动（`disabled: false`），命令的警告会指出这一点。

**用正则直接编辑文本行。** 被拒绝：匹配条目边界、缩进和 `!!js` 值正是仓库 dependencies-over-hand-rolling 策略所反对的脆弱解析。workspace 中已有一个维护良好的 `yaml` AST 库。

## 测试

`apps/cli/tests/plugin-entries.spec.ts` 在真实的临时 `$DSH_HOME` 中驱动 `runToggle`/`runList`，并逐字节断言写入的 `cordis.patch.yml`：条目创建与删除、幂等性、注释与 `!!js` 保留、字面量 `true` 替换、下层停用警告、拼写错误警告、损坏树仍接受开关、按名称解析到真实 id、旧字面量条目清理、无 id 行的拒绝、list 输出的行与状态标签，以及对非数组或无法解析的配置层显式失败。`apps/cli/tests/args.spec.ts` 覆盖三个动词的语法路由与非法调用的拒绝。

## 相关

开关所编辑的层级组合——按 `dsh.profile.bundles` 顺序叠加在组合包之上的 profile patch 层——由 [profile 插件组合包笔记](../architecture/2026-08-05-profile-plugin-bundles.md) 负责。

## 影响

现在 CLI 可以用一个两词动词回答"关掉/打开这个插件"，它操作的就是启动时组合所读取的同一个文件，因此所有后续启动都会应用该开关，长驻界面也能即时生效，`list` 还能在开关前展示某行叫什么。代价是：开关只编辑 profile 自身那一层（`enable` 后下层停用仍然生效——以警告形式提示，而非静默忽略）；行按 entry id 或行名指定，而非包身份，因此不熟悉的组合包的行仍需要先 `list` 查看。`@deepseek-ai/dsh` 为此新增一个运行时依赖（`yaml@^2.9.0`）以进行保留注释的 AST 编辑。