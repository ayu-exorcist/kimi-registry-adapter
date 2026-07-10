# TypeScript 编码规范

本规范适用于本仓库所有 TypeScript 源码、脚本与测试代码。

## 编译配置

- 必须保持 `strict: true`。
- 必须保持以下严格规则开启：
  - `noImplicitReturns`
  - `noUnusedLocals`
  - `noUnusedParameters`
  - `noFallthroughCasesInSwitch`
  - `noImplicitOverride`
  - `noUncheckedIndexedAccess`
  - `noPropertyAccessFromIndexSignature`
  - `exactOptionalPropertyTypes`
  - `useUnknownInCatchVariables`
  - `allowUnreachableCode: false`
  - `allowUnusedLabels: false`
- 仅在外部依赖类型检查成本明显高于收益时允许 `skipLibCheck: true`。

## 类型定义与命名

- 类型别名、接口、泛型参数采用清晰语义命名。
- 对象结构可扩展时优先使用 `interface`；联合、交叉、映射类型、工具类型派生优先使用 `type`。
- 字符串字面量集合优先使用 `as const` 数组 + 联合类型派生，避免引入运行时 enum。
- 同一领域模型只保留一个权威类型来源；配置、状态、注册表、模型能力等领域类型应从核心 schema 或领域模块导出复用。

## `any` 与 `unknown`

- 禁止显式 `any` 类型。
- 未知外部输入必须先使用 `unknown` 表示，并通过 schema、类型守卫或解析函数收窄。
- `JSON.parse`、HTTP 响应、CLI 原始输入等边界数据不得直接假定为领域类型，必须在边界层校验或归一化。

## 空值与可选属性

- 可选属性遵循 `exactOptionalPropertyTypes` 语义：缺失属性与显式 `undefined` 不等价。
- 向领域对象传参时，使用条件展开省略不存在的字段，而不是传入 `field: undefined`。
- 禁止非空断言 `!`。必须通过控制流、显式守卫、早返回或状态机分支完成收窄。

## 类型断言

- 优先使用类型守卫、schema parse、`typeof`、`in`、`instanceof`、可选链完成收窄。
- 类型断言只允许用于以下边界场景：
  - 品牌类型构造函数内部，在完成运行时校验之后进行品牌化。
  - 泛型 JSON/HTTP 客户端返回值，由调用方负责指定并在更外层校验。
  - 第三方库类型缺失或过宽时，使用最小范围断言并保留在适配层。
- 禁止无依据的宽泛断言，如 `as any`、`as unknown as T`。

## CLI 与外部库边界

- 第三方 CLI 库解析出的参数类型属于边界类型，不应直接复用为领域输入类型。
- CLI handler 负责把 `string | undefined`、重复参数、默认值等归一化为领域层需要的结构。
- 领域层函数应接收已经校验、语义明确的参数。

## 泛型与工具类型

- 通用函数可使用泛型，但必须保持约束简单、可读。
- 优先使用内置工具类型（`Pick`、`Omit`、`Partial`、`Required`、`Record`、`Exclude`、`Extract`、`ReturnType`、`NonNullable`）表达派生关系。
- 避免复杂类型体操影响可维护性与编译性能。

## Code Review 检查项

- `pnpm typecheck` 必须通过。
- 不新增显式 `any`、非空断言、`@ts-ignore`。
- 新增外部输入是否经过解析/校验。
- 新增可选属性是否符合 `exactOptionalPropertyTypes`。
- 新增类型是否复用了已有领域类型，避免重复结构漂移。
- 类型修改是否只影响类型层，不改变运行时业务行为。
