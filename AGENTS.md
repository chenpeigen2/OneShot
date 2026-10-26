# OneShot 工程规范

本文件适用于整个仓库的源码、测试中的 TypeScript、代码生成器，以及生成出来的 TypeScript 客户端。公共接口、示例代码和文档示例同样适用。

## 1. 禁止 `any`（强制）

### 1.1 禁止形式

不得新增或使用任何形式的 `any`，包括但不限于：

- `value: any`、`value?: any`
- `Array<any>`、`Promise<any>`、`Record<string, any>`
- `useState<any>`、`useAuth<any>`、泛型默认值 `T = any`
- `value as any`、`catch (error: any)`
- 通过 `as unknown as T` 等双重断言绕过校验
- 为了压制类型错误而故意制造隐式 `any`

`tsconfig` 中的 `strict: true` 不代表没有 `any`：它不能禁止上述显式写法。

### 1.2 替代规则

- **未信任的外部输入使用 `unknown`**：HTTP/JSON、manifest 输入、用户 action body、异常和第三方 untyped 数据进入系统时先声明为 `unknown`。
- **边界必须校验或收窄**：使用类型守卫、结构化校验、PocketBase 返回模型或明确的 parser。类型断言本身不是校验。
- **内部使用领域类型**：`OneshotConfig`、`ServiceEntry`、`CollectionDef`、`SidecarCtx`、记录模型和 action input/output 必须明确，不得退化成开放 map。
- **真正开放的 map 才使用 `Record<string, unknown>`**；已知字段的对象不能使用它代替接口。
- **JSON 使用递归联合类型**，而不是 `any`：

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
```

- **异常使用 `unknown`**：通过 `instanceof Error`、错误结构守卫或统一 `errorMessage(error: unknown)` 处理。
- **泛型必须有实际默认类型或约束**：使用 `satisfies`、泛型参数和具体 Record 类型，不用 `any` 作为逃生口。

### 1.3 生成代码同样禁止 `any`

- action 输入、输出必须有类型；尚未声明模型的旧 action 使用 `unknown`，不能生成 `any`。
- `select` 应生成字符串字面量联合，而不是宽泛 `string`（多值为联合数组）。
- `create/update/register` 使用明确的 DTO；公开注册 DTO 排除 `auth.managed` 字段。
- `useAuth`、`useRecords` 等 React 接口使用生成的记录类型或其真实基类，禁止 `T = any`。
- 不手工修改 `web/src/api`、`pb_hooks`、`dist`；必须修改生成器并重新生成。

## 2. 存量代码不豁免

当前仓库仍存在 `any`，现状**不符合本规范**，不得据此声称已经完成类型治理。

- 立即禁止在任何新增或修改代码中继续引入 `any`，包括复制旧写法。
- 修改某个模块时，必须清理该模块触及范围内的存量 `any`，不能只清理被 diff 高亮的一行。
- 按 `docs/requirements/R4.md` 的阶段清理：发布/core 先行，console/图书模块随后，codegen 与 action 类型最后收口。
- 全量清理完成前，规范检查采用“新增零容忍 + 触及模块清零”；完成后切换为全仓零容忍。

## 3. 可执行验收

仅有代码审查不够，必须形成自动检查：

1. 所有 TypeScript 项目保持 `strict: true` 并运行类型检查。
2. 使用现有 `typescript` 包的 AST 增加 `no-any` 检查，覆盖手写 `.ts/.tsx` 与生成的 TypeScript 客户端；禁止 `AnyKeyword`，由 `strict` 处理隐式 any。不要用简单文本 grep 代替 AST。
3. 代码生成后重新执行生成物类型检查和 `no-any` 检查。
4. 每个模块的完成条件同时包括：构建通过、相关 E2E 通过、该模块 `any` 清零。

检查实现不得为了通过扫描而删除测试、排除业务目录或把 `any` 改写成双重断言。

## 4. 模块组织与修改边界

- 模块拆分和阶段顺序遵循 `docs/requirements/R4.md`；应用项目的目录与依赖方向遵循 `docs/application-structure.md`。
- 新功能不得继续堆进已识别的多职责入口；应先归入对应模块。
- 优先选择小而深的模块接口，不把 `unknown` 当作新的万能类型，也不以“动态语言边界”为由跳过领域建模。
