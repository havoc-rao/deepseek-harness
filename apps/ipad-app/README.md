# @deepseek-ai/dsh-ipad-app

Capacitor iPad 壳，套在 DSH Web 前端（`apps/web`）外面。私密原型，不属于正式发布。

## 当前状态（v2）

**真实前端已在壳内跑通**：`build:web` 构建 `apps/web` 并按 `dsh web` 的协议
组装自包含的引导产物（`__ModuleLoader__` 队列门面 + 两个 parser-blocking
preload + `__DSH_BOOT__` 客户端插件图），`webDist` 里放好全部 45 个 client
bundle，WKWebView 直接以 `capacitor://localhost` 源加载。iPad 模拟器上渲染出
真实 GUI（工作区选择界面）。由于没有宿主进程，`remote`/`typert` 服务可用但无
数据——会话与工作区是下一里程碑（配置远程 harness 端点）的事。

## 命令

```sh
pnpm install                                   # 首次：把本包加入 workspace 并安装 Capacitor
pnpm --filter @deepseek-ai/dsh-ipad-app init:ios  # 从官方 SPM 模板生成 ios/（无需 CocoaPods）
pnpm --filter @deepseek-ai/dsh-ipad-app build:web  # 构建 apps/web + 组装引导图 → web-dist/
pnpm --filter @deepseek-ai/dsh-ipad-app sync       # 把 web-dist 同步进原生工程
pnpm --filter @deepseek-ai/dsh-ipad-app run:ios    # 构建并安装到默认模拟器
pnpm --filter @deepseek-ai/dsh-ipad-app open:ios   # 打开 Xcode 工程（真机调试）
pnpm --filter @deepseek-ai/dsh-ipad-app serve      # 浏览器预览（v1 占位页 www/）
```

### 为什么用 init:ios 而不是 cap add

- `ios/` 的生成默认走 CocoaPods。本机没有 CocoaPods，而 Capacitor CLI 7.6.8
  的 `--packagemanager SPM` 选项有 bug（值先 `toLowerCase()` 再与 `'SPM'` 比较，
  永远不命中，且无 flag 时预检 `checkCocoaPods` 无条件执行）。
- `scripts/init-ios.mjs` 直接解出 CLI 内置的官方 SPM 模板工程（无任何 Pods 引用，
  以本地 Swift package 引用 `CapApp-SPM`），并把模板默认的
  `PRODUCT_BUNDLE_IDENTIFIER`（`com.getcapacitor.App`）改写为
  `capacitor.config.json` 的 `appId`。之后 `cap sync` 走 `determinePackageManager`
  的 `CapApp-SPM` 目录检测，自然进入 SPM 分支。
- `cap add ios` 收尾会跑 `xcodebuild clean`，需要写 `~/Library/Developer/Xcode/
  DerivedData`；在本仓库沙箱里会被拒绝。构建直接用 `-derivedDataPath` 指向工作区
  内目录即可。
- `ios/` 由 `init:ios` 生成，已在根 `.gitignore` 中忽略；换机器后按本流程重新生成。
  构建产物 `.derivedData/` 与 SwiftPM 缓存重定向 `.xcode-home/` 同样忽略。

### build:web 的复刻点

- **行清单**：`dsh web` 的 registry 扫描 Loader 活动条目，即 **base + web-app 两个
  bundle patch 的 insert 并集**。只扫 web-app 会漏掉 base 层的 `api-gateway`
  （提供 `remote`）和 `typert-registry`（提供 `typert`），导致整树依赖死锁
  （38 entries did not activate）。
- **用户 profile 层**：本机的真实 `dsh web` 还会挂载 `~/.dsh/profiles/web` 声明的
  额外 bundle（package.json 的 `dsh.profile.bundles`，各自带 `dsh.bundle.patch`，
  如 `dsh-better-sidebar`、`@havocrao/dsh-client-workspace-logo`）。`build:web`
  默认扫描该 profile 栈（可用 `DSH_IPAD_PROFILE_DIR` 覆盖）；无 profile 时退化为
  base+web-app。这是机器相关的：换机器/换 profile 后重新 `build:web` 即可。
  （已知细微偏差：web-app patch 里 `dsh-code-finder-mount` 行按环境变量条件
  disabled，静态构建不解析 `!!js` 表达式，始终包含该行。）
- **bundle 目录用 `bundles/` 而非 `plugins/`**：Capacitor CLI 的 Cordova 兼容层
  （cordova.js `removePluginFiles`）每次 sync 都会删除 `webDir/plugins`，会清掉
  客户端 bundle。行的 `url` 对模块系统是不透明的，改路径不破坏线上契约
  （`dsh web` 仍在 `/plugins/` 服务）。
- **better-sidebar 的 WS URL 兼容补丁**：该插件以 `new URL(path, location.origin)`
  再交换协议构建 WebSocket 地址；对 `capacitor://` 这类非特殊 scheme，WHATWG
  协议 setter 静默无效，WebKit 的 `new WebSocket` 抛
  「The string did not match the expected pattern」。build:web 对
  `dsh-better-sidebar` 的 bundle 打显式 http(s) 基准补丁（cmd-w /
  agent-terminals / agent-opens 三处）。上游修复应落在插件
  `src/client/*.ts`；补丁未命中时构建会告警并跳过。
- 引导图行与注入严格复用 `@deepseek-ai/dsh-client-modules` 的 `orderByModuleGraph`
  与 `bootInjections`；`renderIndexInjections` 按
  `packages/host/webserver/src/injections.ts` 逐字复刻。

## 里程碑

1. ✅ 壳 + 占位界面跑通
2. ✅ 注入 `__DSH_BOOT__` + `__ModuleLoader__`，静态载荷真实前端渲染
3. 配置远程 harness 端点：真实前端通过 JSON-RPC + SSE 连接电脑或服务器上运行的
   `dsh`。可行路径：Capacitor `server.url` 直接指向远程 `dsh web`（零静态载荷，
   但属壳内嵌网页形态），或保留静态载荷 + 配置 `remote` 端点。需要定传输、
   鉴权与可信主机策略。

## 真机安装（开发签名）

```sh
# 1. Xcode（自动签名）里给 App target 选好 Team（Signing & Capabilities）
# 2. 构建真机包（destination 指定目标设备 UDID，保证描述文件含该设备）：
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS,id=<设备UDID>' \
  -derivedDataPath .derivedData CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates build
# 3. 安装 + 启动：
xcrun devicectl device install app --device <CoreDeviceID> .derivedData/Build/Products/Debug-iphoneos/App.app
xcrun devicectl device process launch --device <CoreDeviceID> ai.deepseek.dsh
```

首次安装后需在 iPad 设置 → 通用 → VPN与设备管理 里**信任**开发者描述文件（免费个人团队 7 天过期，重新构建即可）。`ios/` 由 `init:ios` 生成且已忽略，Team 选择与设备注册都是机器相关的，换机器后重新走此流程。

## 结构

```
www/                  v1 占位页（cap serve 浏览器预览用）
web-dist/             build:web 产物：dist + bundles/ + 注入后的 index.html（已忽略）
capacitor.config.json appId ai.deepseek.dsh / appName / webDir web-dist
scripts/init-ios.mjs  从官方 SPM 模板生成 ios/（含 bundle id 改写）
scripts/build-web.mjs 构建真实前端为自包含静态载荷
package.json          Capacitor 依赖与命令
```