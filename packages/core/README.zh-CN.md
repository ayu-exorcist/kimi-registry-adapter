# @kastral/kra-core

[English](./README.md) | [简体中文](./README.zh-CN.md)

Kimi Registry Adapter 的私有共享库。它包含 CLI 和 HTTP server 使用的实现：配置 schema、模型发现、registry 转换、更新/合并行为、校验、认证存储和状态目录变更。

此包是私有包，在 workspace 内通过 `workspace:*` alias 和 TypeScript path mapping 使用。

## 职责

- 解析并写入带 JSON Schema URL 的 `config.json`。
- 解析并写入 `auth.json`，其中可包含本地 API key 或环境变量名。
- 从 OpenAI-compatible endpoint、Anthropic-compatible endpoint、本地文件或远程 URL 发现模型。
- 使用 `https://models.dev/models.json` 或自定义元数据来源增强已发现模型。
- 将已发现模型转换为可编辑的 Kimi registry entry。
- 在尽可能保留本地编辑的前提下，合并或覆盖生成的应用数据。
- 校验可编辑 registry 文件。
- 安装 git 时，将状态目录变更提交到本地 git 仓库，便于审阅/回滚。
- 为 CLI 调用方提供 operation 层函数。

## 状态布局

大多数函数都会操作如下状态目录：

```text
config.json
registries/<providerId>/api.json
registries/<providerId>/.internal/models.json
registries/<providerId>/.internal/state.json
auth.json
.git/
.kra.lock
.kra.locks/<providerId>.lock
```

只有 `registries/<providerId>/api.json` 适合手动编辑。`.internal/` 下的文件由 KRA 管理，用于保存来源快照和合并状态。安装 git 时会创建提交；没有 git 时，更新合并仍会基于 `.internal/state.json` 正常工作。

使用 `createStatePaths(stateDir, providerId)` 可以得到规范路径。

## 配置模型

Provider 配置支持：

- `name` — provider 显示名称。
- `baseUrl` — provider API base URL。OpenAI 风格 provider 类型（`openai_responses` 和 `openai`）通常以 `/v1` 结尾；Anthropic-compatible provider 通常使用不以 `/v1` 结尾的 `baseUrl`。
- `type` — `openai_responses`、`openai` 或 `anthropic`。
- `modelSource` — 以下之一：
  - `openai_models`，可选 `modelsUrl`
  - `anthropic_models`，可选 `modelsUrl`
  - `local_file`，带 `path`
  - `remote_url`，带 `url`，可选 `auth: "none" | "provider"`；默认是 `none`
- `modelsMetadataPath` — 自定义元数据来源 URL 或本地路径。
- `preserveUnknownModels` — merge 更新时保留已不在生成数据中的可编辑模型。
- `fallbackContext` / `fallbackToolCall` — 当来源和元数据都没有提供值时使用的能力默认值。
- `apiKeyEnv` — provider API key 的环境变量名。
- `updateMode` — `merge` 或 `overwrite`。
- `include` / `exclude` — 模型 ID 过滤规则。
- `overrides` — 针对单个模型覆盖身份信息、限制、能力、thinking effort 档位/默认值和模态。

## 公开 operations

`operations` 模块提供 CLI 使用的高层函数：

- `saveProvider(input)` — 保存 provider 定义，但不更新 registry。
- `setupProviderOperation(input)` — 保存配置，可选地更新 provider，在安装 git 时提交变更，并返回 provider ID、配置路径、可选的可编辑 registry 路径、模型数量、元数据匹配摘要和可选 commit hash。
- `updateProviderOperation(input)` — 更新一个 provider registry，并返回模型数量、元数据匹配摘要、warning/error/conflict 数量和可选 commit hash。
- `configureProviderAuth(input)` — 设置、更新或清除认证配置。
- `listProviders(input)` — 读取已配置的 provider ID。
- `printUrl(input)` — 构建 `http://<host>:<port>/<providerId>/api.json`。
- `validateRegistry(input)` — 校验 `registries/<providerId>/api.json`。
- `getServeCommand(input)` — 构建 `kra serve` 命令。
- `removeProvider(input)` — 删除 provider 配置/认证，并可选删除 registry 文件。

## 更底层的导出

`src/index.ts` 暴露 CLI 使用的 core 公共表面：

- 来自 `fetch-client` 的 fetch helper 和 `KraFetchError`
- 来自 `operations` 的 operation 层 API
- provider descriptor 和 provider ID helper
- 选定的模型来源 helper，例如 `fetchProviderModels`、`readModelsPayload`、`readModelsMetadata` 和 `resolveModelsUrl`
- registry schema 校验函数和 registry 类型
- transform helper 和 metadata match 类型
- diagnostics helper，以及 `diagnosticsLogFile`、`createOperationLogger`、`logDebug`/`logInfo`/`logWarn`/`logError` 等结构化日志函数
- `KraConfig` 和 `ProviderConfig` 类型

`state`、`lock`、`git`、`editable-registry-store` 等模块是 workspace 内部实现模块，不作为此包文档化的公共表面。

完整配置参考见 [Configuration And Registry Reference](../../docs/configuration.md)。

完整状态与更新设计见 [State And Update Design](../../docs/state-and-update.md)。

CLI/server 边界见 [CLI And Server Reference](../../docs/cli-and-server.md)。

健康检查、诊断、进程托管和恢复见 [Operations And Troubleshooting](../../docs/operations.md)。

测试覆盖、生成 schema 检查和验证命令见 [Testing And Verification](../../docs/testing.md)。

## 构建和测试

```sh
pnpm --filter @kastral/kra-core build
pnpm typecheck
pnpm exec vitest run packages/core
```

在仓库根目录运行 `pnpm check` 会执行 workspace 的 lint、typecheck 和测试。

## 相关文档

- [架构](../../docs/architecture.md)
- [CLI 与 server 参考](../../docs/cli-and-server.md)
- [配置与 registry 参考](../../docs/configuration.md)
- [状态与更新设计](../../docs/state-and-update.md)
- [运维与故障排查](../../docs/operations.md)
- [发布与 npm 发布](../../docs/release.md)

## 许可证

MIT。
