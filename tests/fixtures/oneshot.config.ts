import { defineConfig, s, service } from '@oneshot/core'

// e2e 夹具项目：覆盖核心能力（owner 规则/默认值/jsvm action/sidecar action/多环境）
// 注意：baseUrl 走环境变量（tests/run-e2e.mjs 注入），保证隔离实例可移植。
export default defineConfig({
  name: 'e2e-fixture',
  baseUrl: process.env.ONESHOT_PB_URL ?? 'http://127.0.0.1:8099',

  auth: {
    collection: 'users',
    signup: 'public',
    fields: {
      role: s.select(['reader', 'librarian'], { required: true, default: 'reader' }),
      maxBorrow: s.number({ min: 1, max: 20, onlyInt: true, default: 5 }),
    },
    managed: ['role', 'maxBorrow'],
  },

  services: [
    service('tasks', {
      title: '任务',
      collections: {
        tasks: {
          fields: {
            title: s.text({ required: true, max: 200, presentable: true }),
            done: s.bool({ default: false }),
            priority: s.number({ min: 0, max: 3, default: 0 }),
            due: s.date(),
            tags: s.select(['work', 'home', 'errand'], { multi: true }),
            notes: s.json(),
            owner: s.relation('users', { required: true }),
          },
          indexes: ['CREATE INDEX idx_e2e_tasks_owner ON tasks (owner)'],
          rules: { list: 'owner', view: 'owner', create: 'owner', update: 'owner', delete: 'owner' },
        },
      },
      actions: {
        stats: { method: 'GET', rule: 'authenticated', handler: './hooks/tasks.ts#stats' },
        // sidecar：Node 进程权威路径（echo + 回读 PB）
        summary: { method: 'GET', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/tasks.sidecar.ts#summary' },
      },
      hooks: './hooks/tasks.ts',
    }),
  ],

  clients: {
    ts: { outDir: './web/src/api' },
    dart: { outDir: './mobile/lib/api' },
  },

  // 多环境：staging 指向 runner 拉起的第二实例
  environments: {
    staging: { baseUrl: process.env.TEST_STAGING ?? 'http://127.0.0.1:8097', sidecarUrl: 'http://127.0.0.1:7861' },
  },
})
