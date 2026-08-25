# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

### Run from a GitHub Release

The `@deepseek-ai/dsh` family is published to a restricted npm scope, so a fork cannot republish it there. As a self-hosted alternative, this repository can ship the built CLI as a GitHub Release: trigger the **Release dsh to GitHub** workflow (Actions → workflow_dispatch) and it bumps, builds, packs, and uploads every package tarball to a `dsh-v<version>` release.

On the target machine, install the latest CLI release without an npm account:

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/master/scripts/install-dsh-from-github-release.sh \
  | bash -s -- --repo <owner>/<repo>
```

Omitting `--tag` installs the latest release; pass `--tag dsh-v<version>` to pin a specific one. The script downloads every tarball into `$HOME/.dsh` (overridable with `--prefix`), installs them with plain `npm`, symlinks the `dsh` executable into `$HOME/.local/bin`, and verifies with `dsh --version`. See [scripts/install-dsh-from-github-release.sh](scripts/install-dsh-from-github-release.sh) for all options. Requires `bash`, `curl`, `jq`, `tar`, `npm`, and Node.js on the machine.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
