# 图书管理示例（真实图书馆业务模型）

OneShot 框架的完整业务系统示范：**书目/副本两级馆藏**（独立条码 + 五状态流转）、借阅上限、逾期罚款（0.5 元/天、欠款 ≥10 停借）、预约队列（队首优先、有人排队禁续借）、报失赔书、RBAC 三角色（读者/图书管理员/超管）、应用层封禁。

## 运行

```bash
# monorepo 根目录：pnpm install && pnpm build
cd examples/library
mkdir -p node_modules/@oneshot && ln -sfn ../../../../packages/core node_modules/@oneshot/core

# ① 引擎（首次需 superuser upsert admin@demo.dev demo123456）
mkdir -p pb_hooks .oneshot/pb_data
../../examples/todo/.oneshot/pocketbase serve --http 127.0.0.1:8095 \
  --dir .oneshot/pb_data --hooksDir pb_hooks --migrationsDir .oneshot/pb_migrations &

# ② 发布（含种子：4 书目 + 8 副本）+ 控制台（借/还走 sidecar）
ONESHOT_PB_URL=http://127.0.0.1:8095 ONESHOT_SUPERUSER_EMAIL=admin@demo.dev \
ONESHOT_SUPERUSER_PASSWORD=demo123456 node ../../packages/cli/dist/index.js publish
node ../../packages/cli/dist/index.js console --port 7865 &

# ③ 读者前端 → http://127.0.0.1:5174（reader 注册即用；提权 role=librarian 见控制台）
cd web && npm i && npm run dev
```

## 业务验证

`node e2e.mjs`（31 项断言，幂等可重跑）：副本级借还/重复借拒/借完拒/预约排队与队首兑现/借阅上限/逾期罚款入账/报失赔书/收款清零/管理员一键入库/角色越权全拒。

## 文件

- `oneshot.config.ts` —— 全部模型与规则（约 150 行，唯一真源）
- `hooks/library.ts` —— JSVM：目录卫生钩子 + stats 统计
- `hooks/library.sidecar.ts` —— Node：借/还/续/预约/报失/收款/入库/用户管理（系统级写走 service account）
- `web/` —— 读者前端（vite + React，全部走生成的类型化客户端）
- `e2e.mjs` —— 业务全链路断言
