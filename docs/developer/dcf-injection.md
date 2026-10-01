# dcf（dsh-code-finder）构建期注入经验

> 团队本地经验总结（2026-09-27，web profile 实测通过）。未经 docs tier 登记，不属于正式文档门禁范围；入库前需按 [docs/AGENTS.md](../AGENTS.md) 走 i18n 配对与 budget 登记。

dcf = [`@havocrao/dsh-code-finder`](https://github.com/havocrao/DSH-code-finder)：React 组件 → 源码定位工具。定位矩阵与注入语义见其 README；本文只记录 **deepseek-harness 接入**的结论、接法与坑。

## 目标与现状

- Harness 的 web 与 desktop 前端都是**生产构建产物**（`apps/web/dist` 与打包的 `dsh-web-frontend/dist`），React 无 fiber 调试信息（无 `_debugSource`），所以**元素级精确行号只有构建期注入一条路**（第①层 `data-locatorjs`，生产构建同样生效）；fiber 遍历（第②层）在 harness 不可用。
- 注入由 env 控制：`NODE_ENV=development` 是**唯一 env 语义**（生产/未设 NODE_ENV 即零载荷，transform 是 no-op——已回归验证）；构建配置显式 `enabled` 参数是唯一覆盖层（生产语义想带注入时用，不推荐发布）。
- 精确行号的代价：注入版 bundle 体积增大；两个包会触发 rolldown runtime chunk 拆分导致浏览器 boot 失败（见坑 7），已用 `exclude` 排除。

## 一、构建期接线（env 控制）

1. 依赖（根 `devDependencies`）：`@havocrao/dsh-code-finder`，未发布前用 `link:` 指向本地仓库；本地仓库需先 `pnpm install && pnpm build` 产出 `lib/`。
2. 两个接线点：
   - `packages/client/tsdown.client.ts`（**所有 client bundle 共用的 preset**）`clientConfig` 的 plugins 首位：`codeFinderTsdown({ exclude: /ui-sidebar-(?:documentpreview|terminal)\// })`；
   - `apps/web/vite.config.ts`（shell dist）：plugins 加 `codeFinderVite()`。
3. 两条注入通道的坐标语义不同：
   - **tsdown 通道**（动态 client bundles，`lib/client.js`）：tsdown 把物理源 id 交给 transform，`data-locatorjs` **直接是 `src/**/*.tsx:行:列`**，无需反查；
   - **vite 通道**（shell 静态汇编库）：注入 `lib/index.js` 产物坐标，悬停时经 host 半 `/code-finder/api/sourcemap` 反查回 `src/`（已验证 `lib/index.js:82:2 → src/icons/shared-artwork.tsx:14:5`）。
4. 用法：
   ```bash
   NODE_ENV=development pnpm run build:lib:client
   NODE_ENV=development pnpm run build:web
   NODE_ENV=development pnpm dsh web --no-open   # serve 也需 dev 语义（cordis 挂载守卫）；只 serve，不 watch
   ```
   或编排脚本：`pnpm run web:dcf`（构建 + serve 一体）／`pnpm run dev:web:dcf`（watch 全量，Node ≥24）。
   `dev:web:dcf`／`dev:desktop:dcf` 走根 `pnpm run build`，而 scripts/build.ts 会把子进程 NODE_ENV
   钉为 production（除非 `DSH_BUILD_DEV=1`），所以这两个脚本必须同时透传 `DSH_BUILD_DEV=1`
   （2026-10 已修；`web:dcf` 直跑 build:lib:client + build:web，不受影响）。

## 二、运行时挂载（overlay + 路由）

1. 插件必须**装进 profile 的 `node_modules`**：cordis Loader 从 profile 目录（`~/.dsh/profiles/web`）解析包名，仓库根/项目根的依赖对它不可见。pnpm 不可用时（profile 内存在缺失的 `file:` tgz 依赖会卡 install），可按 profile 里其他插件的 `link:` 惯例直接 `ln -s`。
2. profile patch（`~/.dsh/profiles/web/cordis.patch.yml`）必须是**显式 insert**：
   ```yaml
   - insert:
       - id: dsh-code-finder-mount
         name: '@havocrao/dsh-code-finder'
         config:
           roots:
             - /Users/havoc/.dsh/source/current
             - /Users/havoc/Documents/Projects/tools/deepseek-harness
   ```
3. client 半自动生效：包 `dsh.client` 声明 → host serve `/plugins/<entry.id>/client.js` → web kernel 组合加载。index 注入里出现 `dsh-code-finder/client.js` 即成功。
4. host 路由（`POST`）：`/code-finder/api/search`（组件名搜索）、`/code-finder/api/sourcemap`（产物坐标反查）；fence 依赖 `webRuntime.trustedHosts`（loopback 默认放行）。

## 三、验证矩阵（web profile，2026-09-27 实测）

| 项 | 结果 |
|---|---|
| 页面 `GET /`（带 cookie） | 200 |
| index 注入组合 | 含 `dsh-code-finder/client.js` |
| `POST /code-finder/api/search {name: OpenTargetButton}` | 200 → `packages/client/ui-open-in-app/src/client/OpenTargetButton.tsx:81:17` |
| `POST /code-finder/api/sourcemap`（`lib/index.js:82:2`） | 200 → `src/icons/shared-artwork.tsx:14:5` |
| 无 env 构建（tsdown + vite 两通道） | 注入 0、`__LOCATOR_DATA__` 注册表 0 |

浏览器侧交互（Opt+Shift 悬停）需人工确认；curl 只能验证到"组合已交付"。

## 四、踩坑记录

1. **vite 下注册表 key 错拼**：`@locator/babel-jsx` 与 dcf 的 `create-element` 都用 `cwd + filePath` 拼 key，vite root 是子目录（如 `apps/web`）时绝对 filename 不以 cwd 开头，产出 `apps/web` + 绝对路径的错拼。修复在 dcf 仓库：`transform.ts` 对"绝对且不以 cwd 开头"的 id 相对化后传给 babel；`create-element.ts` 的 `registryPaths` 对绝对 filename 直接采用。
2. **patch 行必须是 `- insert:`**：`- id: X config:` 是 id-targeted 覆盖，只在树里已有该 id entry 时生效；没有时整体忽略并报 `patch: entry "X" not found`。挂新插件永远用 insert。
3. **profile 的 `pnpm dsh plugin` 会被缺失的 `file:` tgz 依赖卡死**（`/tmp/xxx.tgz` 被清）：`ENOENT` 于安装期。处理：从 profile `package.json` 移除该依赖行与 bundles 声明、删实体、重跑 `pnpm install` 收敛 lock。
4. **dev:web 在 Node 22.22 崩溃**：tsdown watch 的 `import-without-cache@0.4.0`（`module.registerHooks`）与 tsx 的 load hook 链组合返回 `{format, source: undefined}` → `ERR_INVALID_RETURN_PROPERTY_VALUE`。与 dcf 无关；Node ≥24 正常。绕过：build 一次 + `dsh web` 只 serve（本方案本来就只 serve）。
5. **dsh-remote-vscode 声明 `dsh.client` 却无 `./client` 导出** → client-modules 组合失败阻塞启动。删除误配置声明即可（其 `bridge-client.js` 是 Node 侧库，不是浏览器 bundle）。
6. **dsh-global-tone 用旧 settings API**（`settings.get(ns)`，新版是 `describe(): {ns, value}[]`）→ index 注入渲染抛错 → **页面 400 打不开**（曾误判为"服务没启动"）。修复：改用 `describe().find(ns)`；`register` 保留可选调用。临时规避：profile 层 `disabled: true`。
7. **注入版触发 rolldown runtime chunk 拆分**：`ui-sidebar-documentpreview`（巨型包）与 `ui-sidebar-terminal` 在 `NODE_ENV=development` 构建下拆出 `client.rolldown-runtime.js`，web kernel module table 不支持该相对 `require` → 浏览器 boot 报 `2 entries did not activate / missed the module table`。处理：preset 的 `codeFinderTsdown({ exclude: ... })` 排除这两包，悬停降级为第③层（组件名 + roots 搜索，无元素级行列）。
8. **scripts/build.ts 钉死 NODE_ENV → 编排脚本只透 NODE_ENV 失效**：scripts/build.ts 把子进程 NODE_ENV 钉为 production，除非 `DSH_BUILD_DEV=1`（防环境全局 NODE_ENV=development 把正式构建悄悄变成 instrumented 产物）。`dev:desktop:dcf`／`dev:web:dcf` 旧版本只透 `NODE_ENV=development` → 根 build 产出零注入产物 → 运行时挂载正常（patch/链接都在、插件已加载）但悬停无定位，症状是"构建了却不生效"。处理：两个编排脚本同时透传 `DSH_BUILD_DEV=1`（2026-10 已修）；手跑命令用 `web:dcf` 或显式 `DSH_BUILD_DEV=1 NODE_ENV=development pnpm run build:lib:client`。

## 四·五、多层组件 path（组件链）

hover 任意元素可拿到**完整组件路径**（`App › Sidebar › FolderRow › …`），不只最下层：

- **数据**：注册表 `components` 记录组件声明链。JSX 通道由 `@locator/babel-jsx` 生成（数字下标）；`create-element` 通道（纯 JS / classic script）由 dcf 自己收集（`ce-N` key 空间，与 @locator 数字 key 并存不冲突；function/class/**箭头/memo/forwardRef** 声明都收集——现代 React 组件大多是箭头，只收 function/class 链会大面积缺失）。
- **读取**：`componentChainForExpression` / `componentChainByPosition` 沿 `wrappingComponentId → components` 上溯（20 层护栏 + 环保护），返回 `[最外层, …, 最内层包裹组件]`；`CodeFinderHit.chain` 携带，overlay 第一行显示完整链（链长 >1 时）。
- **边界（如实）**：链 = **文件内声明嵌套**（构建期烙的）；跨文件渲染树（`A.tsx 里 <B/>`）生产构建不可得（那是 fiber 的能力，需 dev React 宿主）。
- **验证**：dcf 测试覆盖（resolve.spec ①f2/①f3 链输出与单层不携带、transform.spec 箭头嵌套链）；真实产物扫描 344/344 表达式→包裹组件命中——注意 DSH 插件里"组件内嵌组件声明"是少数（单组件文件为主），多级链常见于内嵌小组件（如 `const XButton = () => …` 定义在大组件体内）的代码。

## 五、与 dev:desktop 的区别

- **技术栈同源**：desktop（Electron 壳 + `@deepseek-ai/dsh-desktop-host` 子进程跑 `dsh` 的 `desktop` profile）与 web 复用**同一批 client bundles 产物**（`packages/*/lib/client.js`，同一 preset）与**同一个 `dsh-web-frontend/dist`**；主窗口 `dsh-app://app` 把 `/plugins/*` 转发给同一 Web host。因此**构建期注入无需为 desktop 单独接线**：`NODE_ENV=development` 构建出的产物两平台共用。代价：dev 语义下 React 也是 dev 构建（体积/性能开销进产物）；desktop 发布产物按 `NODE_ENV=production` 构建即两平台零载荷——注入与发布互斥，按需二选一。
- **差异只在外壳与挂载面**：
  | 维度 | web | desktop |
  |---|---|---|
  | profile patch | `~/.dsh/profiles/web/cordis.patch.yml` | `~/.dsh/profiles/desktop/cordis.patch.yml`（dev 构建在 `apps/desktop/.desktop-build/.../profiles/desktop`） |
  | 插件安装位置 | profile `node_modules` | 同（desktop profile 的 `node_modules`） |
  | 浏览器面 | 直连 `127.0.0.1:3080` | `dsh-app://app` 转发，`/plugins/*` 带 `no-store` |
  | 认证 | URL token 一次性 | shell 持有 cookie 转发 |
  | 特有风险 | — | 崩溃恢复（`fatal-recovery`）会 `sanitizeProfile` 清掉第三方 bundles，之后需重新接线 |
- **注**：desktop 侧未做端到端实测，接线结论基于代码分析（同一 preset / 同一 dist / 同一 Host 转发链），验收时补一次。
- dev:desktop 的构建阶段同样跑 tsdown（含 watchdog 前的前置 build）；只有 **watch 路径**（dev:web 的 tsdown `--watch`）才撞 Node 22 的 import-without-cache 问题。desktop 的 `dsh-app://` index 注入（`serveWebDocument` 走同一 dist）与 web 一致。