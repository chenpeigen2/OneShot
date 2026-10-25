# OneShot ⚡

**基于 [PocketBase](https://github.com/pocketbase/pocketbase) 的自托管服务发布/生成框架。**

写一个 `oneshot.config.ts`，`oneshot publish` 一条命令：把服务发布成 PocketBase 的 collections（diff 式，可审计、可幂等重放），把 TS hooks 编译进 PB 的 JSVM，并生成 React/Flutter 两端的类型化客户端。**不重复造轮子** —— HTTP 服务、SQLite 存储、认证、文件、realtime、Admin UI 全部来自 PocketBase 本体，OneShot 只做"定义 → 发布 → 生成"这一层。

```
oneshot.config.ts ──publish──▶ PocketBase 实例（collections + 规则 + hooks）
       │                              │
       └──gen──▶ web/src/api  (TS 客户端 + React hooks，包官方 pocketbase JS SDK)
                 mobile/lib/api (Dart 客户端 + 模型，包官方 pocketbase Dart SDK)

控制台：oneshot console → http://127.0.0.1:7860
```

## 快速开始

```bash
pnpm install && pnpm build          # 构建 core / cli / console

oneshot init my-project && cd my-project
pnpm add @oneshot/core              # manifest 需要 @oneshot/core 作为依赖

oneshot engine install              # 下载 PocketBase 二进制到 .oneshot/
oneshot superuser admin@example.com 1234567890
oneshot dev --watch                 # 引擎 + 发布 + 生成，配置/hooks 变更自动重发布
```

服务起来后：

- **PB Admin UI**：http://127.0.0.1:8090/_/
- **OneShot 控制台**：`oneshot console` → http://127.0.0.1:7860 （填 PB 地址 + 超管账号登录；支持服务编辑器写回与备份面板）

## 服务定义（`oneshot.config.ts`）

```ts
import { defineConfig, s, service } from '@oneshot/core'

export default defineConfig({
  name: 'todo',
  baseUrl: 'http://127.0.0.1:8090',
  auth: { collection: 'users', signup: 'public' },

  services: [
    service('tasks', {
      collections: {
        tasks: {
          fields: {
            title: s.text({ required: true, max: 200, presentable: true }),
            done: s.bool({ default: false }),            // 默认值由 JSVM 钩子落库
            tags: s.select(['work', 'home'], { multi: true }),
            owner: s.relation('users', { required: true }),
          },
          rules: { list: 'owner', view: 'owner', create: 'owner', update: 'owner', delete: 'owner' },
        },
      },
      actions: {
        stats: { method: 'GET', rule: 'authenticated', handler: './hooks/tasks.ts#stats' },
      },
      hooks: './hooks/tasks.ts',
    }),
  ],

  clients: {
    ts: { outDir: './web/src/api' },
    dart: { outDir: './mobile/lib/api' },
  },
})
```

**规则**：`public` / `authenticated` / `owner`（自动定位指向 auth collection 的 relation 字段）/ `superuser`，或直接写 PB filter 表达式原文。

**Hooks**（`hooks/*.ts`）：`beforeValidate` / `beforeCreateRequest` / `afterCreate` / `beforeUpdateRequest` / `afterUpdate` / `beforeDelete` / `afterDelete` / 自定义 action handler。上下文：`{ e, app, record?, auth?, query?, body?, http, log }`。拒绝请求抛 PB 内置错误：`BadRequestError` / `ForbiddenError` / ...（消息透传给客户端）。同步逻辑，无 npm/Node API —— 与 PB JSVM（goja）能力一致。

**Sidecar action**（重逻辑的逃生门，Q4 预留口子）：

```ts
actions: {
  // 默认 jsvm：随 PB 单文件部署，同步、无 npm
  stats: { method: 'GET', rule: 'authenticated', handler: './hooks/tasks.ts#stats' },
  // sidecar：跑在真正的 Node 进程（oneshot dev / oneshot console 启动并承载）
  summary: { method: 'GET', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/tasks.sidecar.ts#summary' },
},
```

sidecar handler 是完整 Node：npm 包、异步、`node:crypto` 随便用。鉴权中间件仍在 PB 侧执行，通过后 PB 路由经 `$http.send`（服务间共享 token）转发到控制服务器 `/sidecar/*`；handler 用 `ctx.pbUrl + ctx.token` 回调 PB API —— 用户身份与 collection 规则原样生效，不给 sidecar 超管权限。

## 命令

| 命令 | 作用 |
| --- | --- |
| `oneshot init [dir] [--template todo\|blog\|shop\|chat]` | 初始化项目（内置服务模板，见下） |
| `oneshot publish [--prune] [--no-gen]` | diff 式发布：创建/更新 collections、编译 hooks、生成客户端、写入发布快照 |
| `oneshot gen` | 只跑客户端代码生成（TS + Dart） |
| `oneshot dev [--watch]` | 引擎 + 发布 + 生成（watch 模式增量） |
| `oneshot engine install/up/down` | 下载 / 后台启动 / 停止 PocketBase |
| `oneshot superuser <email> <pass>` | 创建/重置超管 |
| `oneshot console` | 控制服务器：控制台（服务编辑器 + 备份面板）+ manifest 写回 API + sidecar JSON API（同一端口 7860） |
| `oneshot doctor [--json]` | 一键体检：manifest / 引擎 / 连通性 / 凭据 / 快照漂移 / 孤儿 hooks / 磁盘占用（`--json` 供 CI，绝不读 stdin） |
| `pnpm test:e2e` | 全量 e2e（隔离双实例，69 项断言，CI 同款） |

环境变量：`ONESHOT_PB_URL`、`ONESHOT_SUPERUSER_EMAIL`、`ONESHOT_SUPERUSER_PASSWORD`、`ONESHOT_SIDECAR_URL`（compose 内 `http://control:7860`；发布时烘焙进 hooks，支持项目根 `.env`）。

## 生成的客户端

**TS/React**（包官方 `pocketbase` JS SDK，零额外运行时）：

```ts
import { createClient, useAuth, useRecords } from './api/client'

const api = createClient('http://127.0.0.1:8090')
await api.users.login('a@b.c', 'pass')
await api.tasks.create({ title: '买咖啡', owner: user.id })
const stats = await api.tasks.stats()            // 自定义 action

// React
<OneShotProvider baseUrl="http://127.0.0.1:8090">
  <TaskList />   // useAuth() / useRecords<TaskRecord>('tasks', { filter: 'done = false' })
</OneShotProvider>
```

**Dart/Flutter**（包官方 `pocketbase` Dart SDK，模型带 fromJson/toJson）：

```dart
final api = OneShotClient('http://127.0.0.1:8090');
await api.users.login('a@b.c', 'pass');
await api.tasks.create({'title': '买咖啡', 'owner': user.id});
final stats = await api.tasks.stats();
api.tasks.watch((action, record) => refresh());   // realtime
```

## 自托管（Docker Compose）

```bash
cd docker
cp .env.example .env                 # 填入 ONESHOT_SUPERUSER_EMAIL / ONESHOT_SUPERUSER_PASSWORD
docker compose up -d --build         # pb(5587) + control(5588)：启动即发布 examples/todo 并常驻控制台
```

两个容器：`pb`（官方发行物，data/hooks 卷，带 healthcheck）+ `control`（OneShot 控制面，等 pb 健康后自动 `publish --hooks-dir /data/pb_hooks` 再常驻控制台）。hooks 由控制面编译写入共享卷，PB 直接加载；项目默认挂载 `examples/todo`，要换项目改 compose 里 `/project` 的挂载源。

## 内置服务模板

| 模板 | 内容 |
| --- | --- |
| `todo` | 最小入门：tasks + owner 规则 + stats action |
| `blog` | 文章/评论：editor 富文本、slug 自动生成与唯一索引、公开读 + 属主写、级联删除、feature action |
| `shop` | 商品/订单：公开读商品、**sidecar checkout**（跨表库存校验 + Node 计算总价 + 用户身份回写）、restock action |
| `chat` | 房间/成员/消息：组合唯一索引、级联删除、消息 trim 校验 |

```bash
oneshot init my-blog --template blog
```

## 架构与已知约束

- **单实例多服务**：一个服务 = 若干 collections + actions + hooks。发布 = Admin API 调用，秒级生效。
- **发布是幂等的**：provisioner 做字段级 diff（非对称比较，PB 默认值不产生噪音），只创建/更新有差异的 collection；不删字段（控制台手工加的字段会被保留）；`--prune` 才删除 manifest 移除的 collection。
- **JSVM 隔离上下文**（PB 文档约束）：hook handler 里模块顶层绑定不可见。OneShot 的编译器把用户代码打包成 `<svc>.user.pb.js` 模块（进入每个运行时的 require 注册表），entry 里每个 handler 运行时 `require(绝对路径)` 取回用户函数 —— TS 照写，约束由框架消化。
- **多环境**：manifest 里声明 environments，发布时选目标实例（superuser 凭据沿用全局环境变量）：

```ts
export default defineConfig({
  name: 'todo',
  baseUrl: 'http://127.0.0.1:8090',
  environments: {
    staging: { baseUrl: 'http://staging.internal:8090', sidecarUrl: 'http://staging.internal:7860' },
  },
  ...
})
```

```bash
oneshot publish --env staging   # 发布到 staging 实例（hooks 按 staging.sidecarUrl 烘焙）
oneshot publish                 # 默认：顶层 baseUrl
```

**控制台编辑写回**：服务编辑器改字段/规则、增删 collection → 写回 `oneshot.config.ts`（原文件备份 `.bak`，用 git diff/回滚）→ 立即 diff 式发布。GitOps 语义不变：文件仍是唯一真源，控制台只是它的 GUI。注意三点：写回不保留手工注释与排版；从 manifest 删除字段/ collection 不删 PB 侧对象与数据（防误删，彻底删除去 PB Admin UI）；PB 路由注册唯一（sidecar handler 改动由 dev watch 自动热重载 sidecar registry）。
- **发布快照**：写入 `oneshot_meta` collection（项目名、manifest hash、服务清单），控制台据此渲染总览。
- **JSVM 可靠面（v0.40.6 实测）**：`onRecordValidate` + 抛 `BadRequestError` + 文本/日期字段 set 是可靠组合；`onRecordCreateRequest` 在含 json 字段的 collection 上不可依赖、`record.set` 跨 record 写值不持久化、filter 参数注册无效 —— 框架已把这些约束消化进生成器（作用域判断走 `e.record.collection().name`、共享代码走 `.user.pb.js` 模块 + 绝对路径 require、body 字节归一化），**跨表写值类业务逻辑请用 sidecar action**（shop 模板的 checkout 即示范）。
- **测试与 CI**：`pnpm test:e2e` 拉起隔离双实例跑 6 个套件（core 15 / sidecar-realtime 7 / manifest 11 / env-collections 7 / templates 15 / doctor 14，共 69 项断言）；GitHub Actions 在 push/PR 时自动执行同一套件。生成的 TS 客户端过 `tsc --strict`，Dart 过 `dart analyze`。
- **备份**：控制台「备份」页基于 PB 原生 backups API（创建/下载/恢复/删除；恢复会重启 PB）。

## Roadmap

每服务独立实例（`dedicated: true`）· 备份/监控面板 · 模板市场（模板 schema 已就绪）· 编辑器编辑 actions 与 hooks 引用

## 目录

```
packages/core     DSL、manifest 加载、PB 字段/规则映射、provisioner、hooks 编译器、代码生成
packages/cli      oneshot 命令（init/publish/gen/dev/engine/console/superuser）
packages/console  React 控制台（服务编辑器 + 备份面板，Tailwind v4，vite 构建）
examples/todo     可运行的完整示例（含 hooks 与 action）
docker/           自托管 compose（pb + control）
```
