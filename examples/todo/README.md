# OneShot Todo 示例

一个服务（`tasks`）：tasks collection（owner 规则）+ `GET /api/oneshot/tasks/stats` 自定义 action + 生命周期 hooks。

## 运行

```bash
# 在 monorepo 根目录构建一次
pnpm install && pnpm build

# 进入本目录（CLI 已通过 workspace 可用；独立项目请 pnpm add @oneshot/core + 全局装 oneshot）
cd examples/todo
oneshot engine install                          # 下载 PocketBase 到 .oneshot/
oneshot superuser admin@example.com 1234567890  # 首次：创建超管
cp .env.example .env                            # 填入超管账号（或用环境变量）
oneshot dev            # 启动 PB(8090) + 发布 + 生成客户端到 web/src/api 与 mobile/lib/api
```

## 验证

```bash
# 注册 & 登录
curl -s localhost:8090/api/collections/users/records \
  -d '{"email":"a@b.c","password":"1234567890","passwordConfirm":"1234567890"}'
TOKEN=$(curl -s localhost:8090/api/collections/users/auth-with-password \
  -d '{"identity":"a@b.c","password":"1234567890"}' | jq -r .token)

# 建任务（owner 规则：body.owner 必须是自己）
curl -s localhost:8090/api/collections/tasks/records -H "Authorization: $TOKEN" \
  -d '{"title":"买咖啡","tags":["errand"],"owner":"<自己的用户id>"}'

# 自定义 action（JSVM 内执行）
curl -s localhost:8090/api/oneshot/tasks/stats -H "Authorization: $TOKEN"
```

## 生成的客户端

- `web/src/api`：`createClient(baseUrl)` + `useAuth()` / `useRecords('tasks', { filter: ... })`（依赖 npm `pocketbase`、`react`）
- `mobile/lib/api`：`OneShotClient(baseUrl)` + 类型化模型 + `tasks.watch(...)` realtime（依赖 pub.dev `pocketbase`）

## 文件说明

- `oneshot.config.ts` —— 服务定义（唯一真源）
- `hooks/tasks.ts` —— 生命周期 hooks 与 action handler（TS，发布时编译进 PB JSVM）
- `pb_hooks/` —— 发布产物（`tasks.user.pb.js` 用户模块 + `tasks.pb.js` 注册入口），勿手改
