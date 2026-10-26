# OneShot 应用组织结构规范

`examples/library` 是这套结构的参考实现。目标不是增加目录层级，而是让配置、业务、共享运行时、页面、生成物和测试各自有明确位置，并且依赖方向可读。

类型纪律统一遵循根目录 `AGENTS.md`：禁止 `any`，外部数据先解码再进入业务模块。

## 1. 推荐结构

```text
<app>/
  oneshot.config.ts             # 组合根：环境、auth、services、actions、clients
  package.json
  tsconfig.json                 # 后端与配置的独立严格类型检查
  src/
    config/                     # manifest 的组成部分，不含运行时业务
      auth.ts
      collections.ts
    features/                   # 按业务能力组织 handler 与业务规则
      catalog.ts
      circulation.ts
      reservations.ts
      inventory.ts
      members.ts
    shared/                     # 跨 feature 使用的类型、解码和运行时
      records.ts
      values.ts
      pb.ts
      queries.ts
      jsvm.ts
  web/
    src/
      app/
        App.tsx                 # Provider 组合
        Shell.tsx               # 登录状态、导航、toast
      features/
        auth/
        catalog/
        loans/
        admin/
      shared/
        actions.ts              # 通用 action hook
        decoding.ts             # action 返回值解码
        errors.ts
        types.ts
        ui.tsx
      api/                      # OneShot 生成物，不手工修改
      main.tsx
  tests/
    e2e.mjs                     # API 与权限/并发断言
    browser-e2e.mjs             # 真实浏览器路径
    run-e2e.mjs                 # 隔离实例编排与清理
  .oneshot/                     # 本地引擎、token、数据等运行产物，不入库
  pb_hooks/                     # publish 生成物，不入库、不手工修改
```

小项目可以减少 feature 文件，但保留同样的依赖方向。不要按 `models/`、`controllers/`、`services/`、`utils/` 把所有业务重新堆成技术分层；优先让同一个业务能力的变化集中在一个 feature 中。

## 2. 各层职责

### `oneshot.config.ts`

只做组合：选择 auth、collections、actions、hooks 和客户端输出。不要在这里实现借还、校验或 PB 请求。

action 路径直接指向 feature：

```ts
borrow: {
  method: 'POST',
  rule: 'authenticated',
  runtime: 'sidecar',
  handler: './src/features/circulation.ts#borrow',
}
```

框架原生支持嵌套 handler 路径，不需要单文件聚合，也不需要额外的 barrel 文件。

### `src/config`

- `auth.ts`：认证字段、managed、访问规则。
- `collections.ts`：字段、索引、规则和种子。
- 使用 `satisfies AuthSpec` / `satisfies ServiceDef['collections']`，让配置在独立类型检查中生效。

配置与业务 feature 分开，避免一个 500 行的 manifest 同时承担 schema 和运行时。

### `src/features`

按业务能力命名，而不是按技术函数命名：

- `catalog`：目录卫生和统计。
- `circulation`：借书、归还、续借、报失。
- `reservations`：预约和取消。
- `inventory`：入库、追加副本、状态维护。
- `members`：角色、封禁、收款。

每个 feature 可以包含自己的 DTO、业务规则和 handler；只有被多个 feature 使用的代码才下沉到 `src/shared`。

### `src/shared`

- `records.ts`：PB 记录模型、联合类型、运行时 decoder。
- `values.ts`：字符串/数字/布尔/枚举校验与错误。
- `pb.ts`：经过错误处理的 PB 请求和 batch。
- `queries.ts`：跨 feature 复用的领域查询和身份要求。
- `jsvm.ts`：JSVM 上下文的最小类型。

依赖方向必须是 `features → shared`，不允许 `shared → features`，避免循环。

### `web/src`

- `app` 只负责 Provider、登录态、导航和全局提示。
- `features` 按页面业务能力组织，不再把读者端和全部管理页面放进 `App.tsx`。
- `shared/decoding.ts` 负责把 action 的 `unknown` 返回值解码为具体结果，组件不直接读取未验证结构。
- `api/` 始终由生成器维护。

### `tests`

测试与运行源码同级分离。测试使用独立端口、数据目录和进程，不依赖或清空日常 Demo 数据。

## 3. 框架需要提供的支撑

这套结构不只是目录约定，OneShot 提供以下运行时能力：

- `defineSidecarAction(decode, handler)`：强制在外部 JSON 与内部 DTO 之间设置解码接缝。
- `SidecarCtx<TBody>`：action 输入类型可推导，不再使用 `ctx: any`。
- `withSidecarLocks(keys, fn)`：跨 feature 共用同一套进程内锁，避免每个模块各写一份。
- `SidecarActionError`：业务错误携带 HTTP status。
- `JsonValue` / `JsonObject`：开放 JSON 的明确类型。
- `dev --watch` 同时递归监听 `src` 与兼容的 `hooks`，包括共享模块和嵌套 feature。
- `@oneshot/core` 同时提供 ESM import 与 CJS require 入口，确保 sidecar bundle 能加载共享运行时。
- `RuleSpec` 接受 `null`，与运行时的“仅超管”语义一致。
- 生成 TS 的 `BaseRecord` 包含 `collectionId/collectionName`，与 PocketBase `RecordModel` 对齐；action 返回 `unknown`，select 生成字面量联合，公开注册 DTO 排除 managed 字段。

## 4. 禁止事项

- 不把全部 action 重新聚合成 `hooks/<service>.sidecar.ts`。
- 不在 feature 中使用 `ctx: any`、`Record<string, any>`、`Promise<any>` 或 `as any`。
- 不用 `as unknown as T` 代替 decoder。
- 不让不同 feature 各自实现 PB 请求、锁和错误协议。
- 不手改 `src/api`、`pb_hooks`、`dist`、`.oneshot` 中的生成物。
- 不把业务数据写入测试专用实例之外的目录。

## 5. 验收

以 library 为例，结构变更必须同时通过：

```bash
pnpm --filter @oneshot/core build
pnpm --filter oneshot-library-example typecheck
cd examples/library/web && npm run build
cd examples/library && npm run test:e2e
```

根回归 `pnpm test:e2e` 也必须保持通过。完成标准不是文件看起来整齐，而是类型检查、API、真实浏览器和原有公共行为全部一致。
