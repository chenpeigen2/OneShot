# 图书管理示例

一个可运行的真实图书馆业务系统：书目/副本两级馆藏、独立条码、借还续借、逾期罚款、预约队列、报失赔书，以及读者/图书管理员两种应用角色和 PocketBase 超管。

## 已实现

- **读者端**：目录搜索与分类筛选、实时在架数、借书、归还、续借、预约/取消、报失、借阅历史与欠款展示。
- **管理端**：统计概览、书目编辑、新书与副本原子入库、追加副本、架位与状态维护、代办归还、预约队列、角色/封禁/收款。
- **业务约束**：默认最多借 5 册（管理员可按读者调整）、最多续借 2 次、逾期 0.5 元/天、欠款达到 10 元停借、最多预约 3 本、遗失赔书 30 元。
- **权限边界**：公开注册只提交邮箱和密码，服务端通过 `auth.managed` 注入安全默认值；注册提权会被拒绝。读者只能查看自己的借阅和预约，不能修改角色、欠款、借阅上限或业务记录；所有写操作由 action 校验后通过专用系统账号执行。
- **一致性**：多记录写入使用 PocketBase `/api/batch` 数据库事务；未还副本和活动预约的部分唯一索引提供并发兜底。`batch` 在 manifest 中声明，publish 自动开启。

## 启动

先构建 monorepo（根目录的 `pnpm install` 会自动链接本地 `@oneshot/core`）：

```bash
pnpm install && pnpm build
cd examples/library

# 首次启动准备引擎和 PocketBase 超管
node ../../packages/cli/dist/index.js engine install
node ../../packages/cli/dist/index.js superuser admin@demo.dev demo123456

# 启动 PB 8095、publish、控制台和 sidecar 7865
export ONESHOT_SUPERUSER_EMAIL=admin@demo.dev
export ONESHOT_SUPERUSER_PASSWORD=demo123456
node ../../packages/cli/dist/index.js dev --watch --pb-port 8095 --port 7865
```

另开终端启动前端：

```bash
cd examples/library/web
npm install
npm run dev
```

访问 <http://127.0.0.1:5174>。PocketBase Admin UI 为 <http://127.0.0.1:8095/_/>，OneShot 控制台为 <http://127.0.0.1:7865>。前端默认使用 Vite 同源 `/api` 代理，也可通过 `VITE_PB_URL` 指定独立 PB 地址。

### 初始化图书管理员

公开注册不会创建管理员。先注册一个普通账号，再用上面的 PocketBase 超管登录 Admin UI，把该用户的 `role` 改为 `librarian`；重新登录或刷新会话后即可看到“管理工作台”。`oneshot-service@system.local` 是框架维护的专用系统账号，不要修改或删除。

## 验证

```bash
cd examples/library
npm run test:api   # 45 项业务、权限、事务和并发断言
npm run test:e2e   # API + 6 项真实浏览器断言
```

测试使用独立 PB（8195）、sidecar（7866）、Web（5175）和临时数据目录，**不会清空或修改日常 Demo 数据**，结束后自动停止进程并清理。`node tests/run-e2e.mjs --keep` 保留失败现场。浏览器测试优先使用系统 Chrome，没有 Chrome 时先在仓库根目录执行 `pnpm exec playwright install chromium`。

前端构建包含严格类型检查：

```bash
cd examples/library/web
npm run build
```

## 项目结构

本示例遵循 `../../docs/application-structure.md`，按业务能力组织，而不是把全部逻辑塞进单个 hook 或 `App.tsx`：

- `oneshot.config.ts`：只负责组合环境、认证、collections、actions 和客户端输出。
- `src/config/`：认证、collection 字段/索引/规则/种子。
- `src/features/`：`catalog`（目录与统计）、`circulation`（借还续借报失）、`reservations`（预约）、`inventory`（馆藏）、`members`（读者与权限）。
- `src/shared/`：记录模型与 decoder、PB 请求、领域查询、JSVM 类型；依赖方向为 features → shared。
- `web/src/app/`：Provider、登录态、导航和全局提示。
- `web/src/features/`：登录、目录、我的书房、管理端各页面。
- `web/src/shared/`：通用 action hook、结果解码、错误、类型和共享 UI。
- `web/src/api/`：生成的类型化客户端，不手工修改。
- `tests/`：API、真实浏览器和隔离实例编排。
- `tsconfig.json`：后端与配置的独立严格类型检查；`npm run typecheck` 可单独执行。
