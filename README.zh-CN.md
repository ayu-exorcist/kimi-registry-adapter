# Kimi Registry Adapter

[English](./README.md) | [简体中文](./README.zh-CN.md)

Kimi Registry Adapter（KRA）可以从模型发现端点或模型载荷文件生成可编辑的 Kimi Provider Registry，将其保存在本地状态目录中，并提供可被 Kimi 导入的 `api.json` URL。

本项目是一个 pnpm workspace，包含 CLI 和 core 包。

## 环境要求

- Node.js `>=22.18`
- pnpm（通过 `mise` 安装；见 `mise.toml`）

## 使用模式

KRA 面向多种使用流程设计。推荐首次使用时优先选择**交互模式**。

### 交互模式：引导式本地配置

交互模式是配置 provider 最简单的方式，因为它会将设置流程变成菜单式向导：

```sh
pnpm dlx @kastral/kra
npx @kastral/kra
bunx @kastral/kra
yarn dlx @kastral/kra
```

使用你已有的 package runner 即可。`pnpx @kastral/kra` 可作为 `pnpm dlx @kastral/kra` 的简写，`bunx @kastral/kra` 等价于 `bun x @kastral/kra`。当你希望 KRA 引导完成 provider 创建、认证配置、registry 更新、URL 打印以及启动本地 server 时，请使用交互模式。当尚未配置 provider 时，向导会从最小化设置流程开始。至少存在一个 provider 后，主菜单可以管理完整生命周期。

### CLI 模式：可重复执行的命令

当你已经知道 provider 参数，或希望写成可重复执行的 shell 脚本时，请使用命令模式：

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --type openai_responses \
  --api-key-env MOONSHOT_API_KEY \
  --update-mode merge
```

其他命令模式操作包括 `list`、`auth`、`update`、`remove` 和 `serve`。

### 一次性 package runner 执行

已发布的 CLI 可以在不安装到项目中的情况下直接运行。使用你已有的 package runner 即可：

```sh
pnpm dlx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
npx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
bunx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
yarn dlx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
```

长时间运行的 server 模式也可以使用同一个 runner，例如：

```sh
pnpm dlx @kastral/kra serve --host 127.0.0.1 --port 2727
npx @kastral/kra serve --host 127.0.0.1 --port 2727
bunx @kastral/kra serve --host 127.0.0.1 --port 2727
```

使用 `npx` 查看帮助时，请把 CLI 参数放在 `--` 后面，避免被 npm 自己消费：

```sh
npx @kastral/kra -- --help
```

`pnpx @kastral/kra` 可作为 `pnpm dlx @kastral/kra` 的简写，`bunx @kastral/kra` 等价于 `bun x @kastral/kra`。当前不支持 Deno；KRA 是 Node.js CLI。

这适合本地设置、CI 任务和临时机器。除非提供 `--state-dir`，KRA 仍会将状态持久化到 `~/.kimi-registry-adapter`。

### Server 模式：保持 Kimi registry URL 可用

Kimi 会在启动时刷新已导入的 provider registry，因此 KRA HTTP server 应该在启动 Kimi 前就已经运行：

```sh
npx @kastral/kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

使用 `--update-concurrency <n>` 可并发更新多个 provider，使用 `--update-timeout-ms <ms>` 可调整单个 provider 的更新超时时间。默认并发数为 `1`，超时时间为 `30000ms`。

请使用终端、启动脚本或系统服务保持 `kra serve` 运行。KRA 有意不再使用 MCP 来做这件事，因为 MCP server 在 Kimi 启动流程中启动得太晚，无法避免 registry refresh 失败。

故障排查时可通过 `KRA_DEBUG=1` 开启结构化诊断。日志默认写入 `~/.kimi-registry-adapter/logs/kra-debug.log`；`--state-dir` 不会改变该路径，如需自定义请设置 `KRA_LOG_FILE`。常规诊断应优先使用 `KRA_DEBUG=1`，因为交互模式下的 `KRA_LOG=1` 可能记录原始终端输入字节。健康检查、进程托管、安全和恢复细节见[运维与故障排查](./docs/operations.md)。

## 包列表

| 包                                                     | 用途                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`@kastral/kra`](./packages/cli/README.zh-CN.md)       | 已发布的 CLI，用于交互模式、命令模式、一次性 package runner 执行和 `serve`。 |
| [`@kastral/kra-core`](./packages/core/README.zh-CN.md) | 私有共享库，负责配置、认证、更新、转换、校验和状态变更。                     |

## 快速开始

最短路径是交互模式：

```sh
pnpm dlx @kastral/kra
npx @kastral/kra
bunx @kastral/kra
yarn dlx @kastral/kra
```

完成设置后，请在启动 Kimi 前启动本地 registry server：

```sh
npx @kastral/kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

配置多个 provider 时，可通过 `--update-concurrency <n>` 和 `--update-timeout-ms <ms>` 调整启动前和定时更新行为。

在 Kimi 中导入打印出的 URL。单个 provider 的 URL 形如：

```text
http://127.0.0.1:2727/<providerId>/api.json
```

KRA 也会在以下地址提供聚合 registry：

```text
http://127.0.0.1:2727/api.json
```

## 状态目录

默认状态目录是 `~/.kimi-registry-adapter`。

```text
config.json                              # provider 定义和默认值
registries/<providerId>/api.json          # 可编辑并提供给 Kimi 的 registry
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json  # KRA 元数据，包括 lastGeneratedRegistry
auth.json                                # 可选的本地凭据或环境变量名
.git/                                    # 安装 git 时，状态变更会提交到本地 git，便于审阅/回滚
```

只编辑 `registries/<providerId>/api.json`。不要编辑 `.internal/` 下的文件；KRA 使用这些文件保存来源快照和更新合并基线。

安装 git 时，KRA 会提交成功的 `add`、`update` 和 `remove` 状态变更。如果未安装 git，KRA 仍会使用 `.internal/state.json` 正常更新和合并 registry。如果你手动编辑 `api.json`，请先校验 JSON 结构后再用 git 提交；KRA 在加载 registry 并提供服务时也会校验 registry 文件。后续 `kra update` 通常使用 `.internal/state.json.lastGeneratedRegistry` 作为合并基线。如果内部状态不可用，KRA 会依次回退到已提交的 `api.json` 和本次新生成的 registry；因此只有在该回退场景中，手动 commit 才可能成为恢复基线。

CLI 命令可通过 `--state-dir <path>` 指定其他目录。

KRA 会串行化使用同一本地状态目录的 KRA 进程之间的全局状态变更和同一 provider 的 registry 写入。耗时的模型发现会在写锁外执行；不同 provider 的 registry 写入可以并发，config/auth 变更和 git commit 仍会串行。写入前 KRA 会重新检查 provider 和 auth 状态。该保证不覆盖手动编辑状态文件、在状态目录中直接运行 git 命令、其他未获取 KRA 锁而写入该目录的工具，也不覆盖多个主机同时写入网络共享状态目录的场景。

## 配置要点

Provider 配置支持：

- provider 类型：`openai_responses`、`openai`、`anthropic`
- base URL：`openai_responses` 和 `openai` provider 通常使用以 `/v1` 结尾的 `baseUrl`；`anthropic` provider 通常使用不以 `/v1` 结尾的 `baseUrl`
- 模型来源：`openai_models`、`anthropic_models`、`local_file`、`remote_url`
- 模型 ID 的 include/exclude 过滤
- 从 `https://models.dev/models.json` 或自定义来源进行模型元数据增强
- 针对单个模型覆盖名称、家族、限制、工具调用、reasoning、interleaved 支持、thinking effort 档位/默认值和模态
- 更新模式：`merge` 或 `overwrite`

生成的 JSON Schema 位于 [`schemas/config.schema.json`](./schemas/config.schema.json)。

## 文档

- [文档地图](./docs/README.md)
- [架构](./docs/architecture.md)
- [CLI 与 server 参考](./docs/cli-and-server.md)
- [配置与 registry 参考](./docs/configuration.md)
- [状态与更新设计](./docs/state-and-update.md)
- [运维与故障排查](./docs/operations.md)
- [发布与 npm 发布](./docs/release.md)
- [测试与校验](./docs/testing.md)
- [终端主题集成](./docs/terminal-theme.md)
- [交互终端生命周期](./docs/interactive-terminal.md)

## 开发

安装依赖：

```sh
pnpm install
```

从源码运行交互式 CLI：

```sh
pnpm dev
```

从源码查看命令模式帮助：

```sh
pnpm dev -- --help
```

构建所有包：

```sh
pnpm build
```

运行检查：

```sh
pnpm check
```

单独运行检查：

```sh
pnpm lint
pnpm typecheck
pnpm config-schema:check
pnpm test
pnpm coverage
```

CI 还会在 `pnpm check` 之后运行 `pnpm build` 和 `pnpm test:binary`。

检查格式：

```sh
pnpm fmt
```

应用格式化：

```sh
pnpm fmt:fix
```

## 发布产物

CLI 包会从 `dist` 暴露 ESM 构建产物和类型声明：

- `@kastral/kra` 发布 `kra` binary。

`@kastral/kra-core` 是 CLI 包使用的私有 workspace 包，并会被打包进 CLI 构建产物。

发布由 Changesets 管理。config schema URL 指向当前 `main` 分支的 schema 文件。用户可见的 CLI 变更需要添加 changeset：

```sh
pnpm changeset
```

本地预览发布：

```sh
pnpm release:dry
```

在 `main` 分支上，`.github/workflows/release.yml` 会创建 release PR，并在该 PR 合并后发布到 npm。发布前需要先在 npm 为 `@kastral/kra` 配置 Trusted Publishing。

## 许可证

MIT。见 [LICENSE](./LICENSE)。
