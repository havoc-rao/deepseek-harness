# @havocrao/dsh-client-workspace-logo

[English](README.md) | 中文

工作区 logo 界面插件:填充 [dsh-client-ui-workspace](../ui-workspace/README.zh.md) 的三个工作区行槽位——16px 前导单元(`sidebar.workspaces.workspaceIcon`)、省略号菜单底部(`sidebar.workspaces.workspaceMenu`)与悬停卡头部(`sidebar.workspaces.workspaceHoverIcon`)——呈现工作区 logo 图片、图片选择器与宿主持久化提交。

logo 本身是宿主拥有的工作区数据:`logo` 数据 URL 存在于工作区记录中,经 `WorkspaceView.logo` 提供,并通过核心 `workspace.setLogo` RPC 替换或清除(null 清除;导线与持久化上限由 apiproxy schema 套件钉为相等)。本包只贡献界面:行单元以文件夹图标作为无 logo / 加载中 / 失败的回退渲染宿主 logo;菜单底部入口打开图片选择器(读取数据 URL 前强制校验图片 MIME 与 2 MiB 字节上限);悬停卡在标题旁显示卡片尺寸的 logo。选取通过包装 `ctx.workspaces.setLogo` 的 inject 面提交;失败仅作为控制台诊断输出,返回的视图会重绘该行。

挂载本包即用一行 cordis.yml 组合出整个界面:用 `dsh plugin --profile <name> add @havocrao/dsh-client-workspace-logo`(或 tarball/path 规格)安装,`dsh plugin --profile <name> disable ui-workspace-logo` 卸载——无需重启即可让行回到纯文件夹图标与纯标题卡片。

Node 半边是空的 `apply`:它只让插件出现在宿主 cordis.yml 与 Loader 中;浏览器半边经 `exports["./client"]` 发布,并通过 `dsh.client` manifest 声明被发现。

## 安装

盒内 web profile 已默认挂载该表面(dsh-web-app patch 行 `ui-workspace-logo`);用 `dsh plugin --profile web disable ui-workspace-logo` 关闭、`enable` 恢复,浏览器半无需重启服务器。

已发布 npm 通道(任意 profile):

```
dsh plugin --profile web add @havocrao/dsh-client-workspace-logo
```

源码或 tarball 通道与普通依赖一样把包装进 profile(tarball/path 规格会按包真实名协调,manifest 携带 `dsh.bundle.patch` 时自动加入 profile 的 bundle 栈)。任何客户端侧改动后硬刷新浏览器(Cmd/Ctrl+Shift+R);本包 host 半是空占位,单独此包无需重启 DSH。pnpm 11 默认拦截安装脚本——若未来构建脚本被拒,在 profile 目录批准(`pnpm approve-builds`)。

## 模型体验

无。工作区 logo 界面是浏览器 chrome;这里没有任何内容到达模型请求。

#### KV Cache 影响

无;本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **不缩小图片**——选择器把图片字节限制在 2 MiB,但存储的是全尺寸数据 URL;canvas 缩小处理暂缓,因此注册表文件会随大 logo 增长直至上限。
- **界面中没有清除入口**——清除需要走导线 `workspace.setLogo(workspaceId, null)`;未来的菜单条目可以暴露它。