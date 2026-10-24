import type { OneshotConfig } from '@oneshot/core'
import { defineConfig, s, service } from '@oneshot/core'

/** 待办模板：最小入门示例（tasks + owner 规则 + stats action） */
export function todoConfig(): OneshotConfig {
  return defineConfig({
    name: 'todo',
    baseUrl: 'http://127.0.0.1:8090',
    auth: { collection: 'users', signup: 'public' },
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
            indexes: ['CREATE INDEX idx_tasks_owner ON tasks (owner)'],
            rules: { list: 'owner', view: 'owner', create: 'owner', update: 'owner', delete: 'owner' },
          },
        },
        actions: {
          stats: { method: 'GET', rule: 'authenticated', handler: './hooks/tasks.ts#stats' },
        },
        hooks: './hooks/tasks.ts',
      }),
    ],
    clients: { ts: { outDir: './web/src/api' }, dart: { outDir: './mobile/lib/api' } },
  })
}

export const TODO_HOOKS_TASKS = `// tasks 服务的生命周期 hooks 与自定义 action。
// 由 oneshot publish 编译成 pb_hooks/tasks.user.pb.js（用户模块）+ tasks.pb.js（注册入口），
// 在 PocketBase 内置的 goja JSVM 里执行（无 npm / Node API，保持同步逻辑）。
//
// ctx: { e, app, record?, auth?, query?, body?, http(opts), log(...) }
//
// 拒绝请求请抛 PB 内置错误类型（消息会透传给客户端）：
//   BadRequestError / ForbiddenError / NotFoundError / ...

export function beforeValidate(ctx: any) {
  const title = String(ctx.record.get('title') ?? '').trim()
  if (!title) throw new BadRequestError('title 不能为空')
  ctx.record.set('title', title)
  ctx.log('beforeValidate', ctx.record.id)
}

export function afterCreate(ctx: any) {
  ctx.log('created', ctx.record.id)
}

// GET /api/oneshot/tasks/stats
// 注意：JSVM 里 countRecords 的过滤参数需要 dbx.Expression，
// 带字符串过滤的统计用 findRecordsByFilter（文档化 API）。
export function stats(ctx: any) {
  const total = ctx.app.countRecords('tasks')
  const done = ctx.app.findRecordsByFilter('tasks', 'done = true', '', -1, 0).length
  const mine = ctx.auth ? ctx.app.findRecordsByFilter('tasks', \`owner = "\${ctx.auth.id}"\`, '', -1, 0).length : 0
  return { total, done, mine }
}
`
