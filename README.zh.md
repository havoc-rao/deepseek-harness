# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

<a id="run-from-release"></a>

### 从 GitHub Release 运行

`@deepseek-ai/dsh` 系列发布在受限的 npm 作用域下，fork 无法在那里重新发布。作为自托管替代方案，本仓库可以把构建好的 CLI 作为 GitHub Release 发布：触发 **Release dsh to GitHub** 工作流（Actions → workflow_dispatch），它会完成版本升级、构建、打包，并把所有包 tarball 上传到 `dsh-v<版本>` release。

在目标机器上，无需 npm 账号即可安装最新版 CLI：

```sh
curl -fsSL https://raw.githubusercontent.com/havoc-rao/deepseek-harness/master/scripts/install-dsh-from-github-release.sh \
  | bash -s -- --repo havoc-rao/deepseek-harness
```

如果 `raw.githubusercontent.com` 在你的网络不可达（这里的 `403` 通常是 raw 域名被网络阻断，而非文件缺失），改用 jsDelivr CDN 获取同一脚本：

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/havoc-rao/deepseek-harness@master/scripts/install-dsh-from-github-release.sh \
  | bash -s -- --repo havoc-rao/deepseek-harness
```

省略 `--tag` 则安装最新 release；传 `--tag dsh-v<版本>` 可固定特定版本。脚本会把所有 tarball 下载到 `$HOME/.dsh`（可用 `--prefix` 覆盖），用原生 `npm` 安装，把 `dsh` 可执行文件软链接到 `$HOME/.local/bin`，并用 `dsh --version` 校验。所有选项见 [scripts/install-dsh-from-github-release.sh](scripts/install-dsh-from-github-release.sh)。目标机器需安装 `bash`、`curl`、`jq`、`tar`、`npm` 与 Node.js。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
