# @kastral/kra

[English](./README.md) | [简体中文](./README.zh-CN.md)

Kimi Registry Adapter 的命令行界面。它可以从 OpenAI-compatible、Anthropic-compatible、本地或远程模型来源创建并维护可编辑的 Kimi provider registry，并提供可供 Kimi 导入的 URL。

## 环境要求

- Node.js `>=22.18`
- 一个 package runner，例如 `pnpm dlx`、`npx`、`bunx` 或 `yarn dlx`

`pnpx @kastral/kra` 可作为 `pnpm dlx @kastral/kra` 的简写，`bunx @kastral/kra` 等价于 `bun x @kastral/kra`。当前不支持 Deno；KRA 是 Node.js CLI。

## 安装 / 运行

无需安装到项目中，直接运行已发布的 CLI：

```sh
pnpm dlx @kastral/kra --help
npx @kastral/kra -- --help
bunx @kastral/kra --help
yarn dlx @kastral/kra --help
```

`npx` 可能会消费 `--help` 等参数；使用 `npx` 时，请把 CLI 参数放在 `--` 后面。`pnpx @kastral/kra` 可作为 `pnpm dlx @kastral/kra` 的简写。

在本仓库中进行本地开发：

```sh
pnpm dev -- --help
```

## 推荐：交互模式

交互模式是本地设置的主要使用体验：

```sh
pnpm dlx @kastral/kra
npx @kastral/kra
bunx @kastral/kra
yarn dlx @kastral/kra
```

使用你已有的 package runner 即可。`pnpx @kastral/kra` 可作为 `pnpm dlx @kastral/kra` 的简写，`bunx @kastral/kra` 等价于 `bun x @kastral/kra`。当你希望 KRA 引导流程，而不是记忆命令参数时，请使用交互模式。第一次配置 provider 时尤其适合，因为在没有 provider 的情况下，它会打开最小化设置流程。

至少存在一个 provider 后，交互式主菜单支持：

- 添加另一个 provider
- 列出已配置 provider 和导入 URL
- 更新 provider 设置，包括认证来源和 registry refresh
- 删除 provider
- 启动本地 registry server

典型交互流程：

1. 启动 `pnpm dlx @kastral/kra`、`npx @kastral/kra`、`bunx @kastral/kra` 或 `yarn dlx @kastral/kra`。
2. 添加 provider。
3. 选择模型来源和要包含的模型。
4. 使用环境变量名配置认证。
5. 更新 registry。
6. 启动 server 或列出导入 URL。
7. 在 Kimi 中导入 `http://127.0.0.1:2727/<providerId>/api.json`。

## CLI 命令模式

命令模式适合可重复执行的 shell 脚本、CI 任务，以及已经知道 provider 参数的用户。

### 添加 provider 定义

`add` 会写入 provider 配置，默认更新可编辑 registry，在安装 git 时提交状态变更，并打印 Kimi 导入 URL。传入 `--no-update` 时才只写入 provider 配置：

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --type openai_responses \
  --api-key-env MOONSHOT_API_KEY
```

### 添加 provider 并立即更新

默认的 `add` 行为会保存配置、更新可编辑 registry，在安装 git 时提交状态变更，并打印 Kimi 导入 URL 和推荐的 serve 命令：

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --type openai_responses \
  --api-key-env MOONSHOT_API_KEY \
  --update-mode merge
```

### 配置认证

推荐保存环境变量名，而不是保存原始 key：

```sh
npx @kastral/kra auth moonshot --api-key-env MOONSHOT_API_KEY
```

对于一次性的 add 或 update 运行，可以传入 `--api-key <key>`；命令实现不会将该临时值写入 `config.json`。使用 `auth --clear` 可删除某个 provider 已保存的认证配置。

### 更新

```sh
npx @kastral/kra update moonshot --update-mode merge
```

使用 `update --dry-run` 可预览更新而不写入文件。当它与 `--update-mode` 组合使用时，dry-run 不会将该模式持久化到 `config.json`。使用 `update --force` 可在当次运行中覆盖可编辑 registry。

### 列出 provider 和导入 URL

```sh
npx @kastral/kra list
```

`list` 会返回已配置的 provider ID。交互模式的列表视图也会按当前 host 和 port 渲染导入 URL。

### 通过 HTTP 提供 registry

```sh
npx @kastral/kra serve --host 127.0.0.1 --port 2727 --update-interval 1h
```

除非传入 `--no-update`，`serve` 可以在启动前更新已配置 provider。定时更新会在每次运行时重新读取已配置 provider 列表。使用 `--update-concurrency <n>` 可并发更新多个 provider，使用 `--update-timeout-ms <ms>` 可设置单个 provider 的更新超时时间；默认并发数为 `1`，超时时间为 `30000ms`。

### 删除 provider

```sh
npx @kastral/kra remove moonshot --keep-files
```

`remove` 会清除存在的同名 provider 配置和已存储认证。省略 `--keep-files` 时，还会删除 `registries/<providerId>/`；因此也可以用它清理 `config.json` 中已无对应 provider 的孤立本地 registry。

## 一次性 package runner 模式

上面的所有 CLI 示例都可以作为一次性 package runner 命令运行。适用场景包括：

- 不全局安装即可试用 KRA
- 在临时机器上运行
- 编写 CI 或本地 bootstrap 脚本
- 分享可复制粘贴的 bootstrap 命令

示例：

```sh
pnpm dlx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
npx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
bunx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY
yarn dlx @kastral/kra add moonshot --base-url https://api.moonshot.cn/v1 --api-key-env MOONSHOT_API_KEY

pnpm dlx @kastral/kra update moonshot
pnpm dlx @kastral/kra serve --host 127.0.0.1 --port 2727
```

除非提供 `--state-dir <path>`，状态仍会持久化到 `~/.kimi-registry-adapter`。

## 状态目录

默认情况下，KRA 将状态保存在 `~/.kimi-registry-adapter`：

```text
config.json                              # provider、server 默认值、update 默认值
registries/<providerId>/api.json          # 可编辑并提供给 Kimi 的 registry
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json
auth.json                                # 可选的本地凭据或环境变量名
.git/                                    # 安装 git 时，状态变更会提交到本地 git，便于审阅/回滚
```

只编辑 `registries/<providerId>/api.json`。不要编辑 `.internal/` 下的文件；KRA 使用这些文件保存来源快照和更新合并基线。未安装 git 时，KRA 仍会正常更新和合并 registry，只是不创建 commit。

在命令中使用 `--state-dir <path>` 可以覆盖默认路径。

## 模型来源

Provider discovery 支持以下来源：

- `openai_models` — 拉取 OpenAI-compatible models endpoint。这是 OpenAI 风格 provider 的默认来源。
- `anthropic_models` — 拉取 Anthropic-compatible models endpoint。
- `local_file` — 读取本地 models payload。
- `remote_url` — 从任意 URL 拉取 models payload。除非配置显式设置 `modelSource.auth` 为 `provider`，否则 provider API key 不会发送给 `remote_url` 来源。

在交互式 add/update 中，模型来源输入为空表示使用 provider 类型的默认 endpoint，输入 `http://` 或 `https://` URL 会保存为 `remote_url`，其他输入会保存为 `local_file`。

对于 `--base-url`，OpenAI 风格 provider 类型（`openai_responses` 和 `openai`）通常以 `/v1` 结尾；Anthropic-compatible provider 通常使用不以 `/v1` 结尾的 `baseUrl`。

示例：

```sh
npx @kastral/kra add local-provider \
  --base-url http://localhost:4000/v1 \
  --model-source local_file \
  --model-source-path ./models.json

npx @kastral/kra add remote-provider \
  --base-url https://api.example.com/v1 \
  --model-source remote_url \
  --model-source-url https://example.com/models.json
```

对 endpoint 类型的来源，可同时传入 `--model-source openai_models` 或 `--model-source anthropic_models` 与 `--model-source-url <url>` 来覆盖完整 models endpoint。元数据增强默认使用 `https://models.dev/models.json`；可通过 `--models-metadata-path <url-or-file>` 覆盖为其他 URL 或本地文件。

## 过滤与更新模式

命令模式可使用 `--include` 和 `--exclude` 控制写入可编辑 registry 的模型 ID。交互模式会询问要包含哪些已获取模型，并省略单独的 exclude 提示，以保持引导流程简短。模式可以重复传入、用空格分隔，或用逗号分隔。

```sh
npx @kastral/kra add moonshot \
  --base-url https://api.moonshot.cn/v1 \
  --include "kimi-*" \
  --exclude "*-preview,*-deprecated"
```

交互式新增和刷新始终使用 `merge`，引导流程不再要求用户选择更新策略。命令模式仍保留两种更新模式：

- `merge` 会尽可能保留本地编辑；当上游变更和本地编辑无法协调时，会在 `.internal/state.json` 中记录冲突，并保留当前可编辑值。
- `overwrite` 会基于 discovery 结果重新生成应用数据；需要时请显式使用 `--update-mode overwrite` 或 `--force`。

## `serve` 提供的 HTTP 端点

- `GET /healthz` — 运行时健康信息和已加载的 provider ID。即使 JSON 中的 `status` 为 `degraded`，该端点仍返回 HTTP `200`。
- `GET /api.json` — 所有已加载 provider 的聚合 registry。
- `GET /:providerId/api.json` — 单个 provider 的 registry；这是用于 Kimi 导入的 URL。

## 诊断日志

设置 `KRA_DEBUG=1` 可写入结构化 JSON Lines 诊断日志。默认路径为 `~/.kimi-registry-adapter/logs/kra-debug.log`；命令的 `--state-dir` 不会改变该路径，`KRA_LOG_FILE=<path>` 可以覆盖它。`KRA_LOG_LEVEL` 接受 `debug`、`info`、`warn` 或 `error`。

常规故障排查应优先使用 `KRA_DEBUG=1`。交互模式下的 `KRA_LOG=1` 还会在 debug 级别记录原始 stdin 数据块，可能捕获在提示中输入的 secret。分享前请审查并妥善保护日志。KRA 不负责日志轮转。

## 相关文档

- [架构](../../docs/architecture.md)
- [CLI 与 server 参考](../../docs/cli-and-server.md)
- [配置与 registry 参考](../../docs/configuration.md)
- [状态与更新设计](../../docs/state-and-update.md)
- [运维与故障排查](../../docs/operations.md)
- [发布与 npm 发布](../../docs/release.md)
- [测试与校验](../../docs/testing.md)

## 许可证

MIT。
