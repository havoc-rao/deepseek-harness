# Agent Note: 会话无关的右侧 Sidebar 停靠面

Status: implemented

[English](2026-09-12-rightbar-session-independent-surface.md) | 中文

## Problem

右侧 Sidebar 的座位、展开控件与 tab 正文都是严格 `session` 作用域席位：没有选中会话就没有 header、没有按钮、没有面板，`ctx.sidebarRight` 的写操作直接抛错（「no session surface is mounted」）。因此无会话窗口里切换右栏的快捷键（dsh-hotkey 的 `Cmd+Opt+B`）什么都不做；新建（blank）会话把 header 渲染成 `display:none`，展开按钮离开 DOM，同一快捷键的 DOM 兜底在弹窗窗口里随之失效。

## Decision

右侧 Sidebar 全面 session-maybe 化，并带一个保留的会话无关停靠面。

凡原为 `scope: 'session'` 的右侧栏席位全部改为 `scope: 'session-maybe'`：面板席位 `rightbar.session`、tab 正文/标题席位 `sidebar.right.pane.tab` / `.title`、菜单席位 `sidebar.right.tab.menu.item`、引导链 `sidebar.right.tab.guide`，以及会话 header 角落 `conversation.session.header.corner`。它们共用一个 store handle——slot 运行时允许，因为所有席位都是 session-maybe。有当前会话时运行时按会话各铸一个 store 实例，席位行为与从前完全一致；没有时全部解析到同一个保留实例，其停靠面放在保留键 `'root'` 下（与渲染器为自己保留的 root store 实例相同的字面量；宿主铸造的会话 id 永远不会撞上它）。渲染器的 store 实例轴把 session-maybe handle 的空绑定解析到这个保留实例，而不再抛错。

没有当前会话时，座位把保留键绑定为当前停靠面，于是 `ctx.sidebarRight` 的每个命令都作用于会话无关停靠面：`toggleExpanded`、`isExpanded`、`openTab`、`openResource`、`focus`、`split`、`float`、`dock` 在无会话窗口里全部可用，只有在完全没有挂载席位（没有右栏的布局）时才抛错。tab 实例、导航与资源钉住都按保留键记账，与任何会话 id 无异；会话无关停靠面的状态在会话来去之间保持不变（实例随 handle 生命周期缓存）。

两个展开入口补全契约。hero 把同一个展开控件挂进新增的角落席位 `conversation.hero.corner`（session-maybe；一旦会话存在它把自己渲染掉，因为会话 header 的角落接管），加入 Conversation 壳的 children 声明。blank 会话的 header 也不再整体隐藏：`ConversationSessionHeader` 渲染一条只有角落的窄带（标题、工具组与标签仍隐藏；角落渲染为空时整条经 CSS `:has()` 收起），新会话的展开按钮因此存活。tab 正文席位改为 session-maybe，让会话无关面板能画出它的 tab；依赖会话的 tab 类型在那里显示自己的缺席态（文件树的「无工作区」），直到会话存在。

声明了 store 的席位，其 inject 工厂现在总能拿到确定的 `actions`：渲染器对声明了 store 的席位总是铸出实例（无会话时亦然），因此 `InjectParams` 不再把它们标成 `| undefined`。

## Alternatives considered

**并行的 root 作用域停靠面。** 第二个完整停靠面（`rightbar.global` 配自己的 store 与正文席位）会复制整台面板机制，并迫使每个 tab 类型把正文注册两次；共享 handle 只能挂一个作用域的规则又逼出第二个 store，无法与会话席位共享状态。session-maybe 重挂一个 handle、一块面板、一套正文，把「无会话」的全部知识收敛到保留键一处。

**blank 时渲染完整会话 header。** 给 blank 会话显示标题行与标签，是给毫无内容的 hero 添上无话可说的内容；角落窄带保留现有 blank 行为（settling、居中 hero）的全部，只多出那个真正可达的控件。

**暴露可观察的控制器。** hero 角落本可经新的 `ctx.sidebarRight` 订阅读取展开态。共享 store 本身就是可观察源；角落复用与 header 角落相同的席位模式，而不是加宽服务面。

## Consequences

dsh-hotkey 的右栏切换在无会话窗口里可用（`toggleExpanded` 作用于会话无关停靠面；`[data-sidebar-right-expand]` 在 hero 角落与 blank 会话 header 里都存在），逐会话行为不变。slot 契约把七个席位记为 session-maybe；仓库内所有注册方（ui-sidebar-files、ui-sidebar-documentpreview、ui-sidebar-right）都按 maybe 标准 props 适配，因此仓库外的 `sidebar.right.pane.tab` 注册方必须在同一改动里把 `sessionId` 视为可选。会话无关停靠面只能展示其 tab 类型在无会话时能提供的内容；依赖会话的类型显示缺席态，文件树在没有会话时也没有可列的根。渲染器 session-maybe store 解析（空绑定 → 保留实例）为任何未来的 session-maybe store 席位泛化了席位契约。