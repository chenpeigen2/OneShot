// tasks 服务的生命周期 hooks 与自定义 action。
// 由 oneshot publish 编译成 pb_hooks/tasks.user.pb.js（用户模块）+ tasks.pb.js（注册入口），
// 在 PocketBase 内置的 goja JSVM 里执行（无 npm / Node API，保持同步逻辑）。
//
// ctx: { e, app, record?, auth?, query?, body?, http(opts), log(...) }
//   - app:   PocketBase core app（$app）：findRecordsByFilter / countRecords / findRecordById ...
//   - http:  $http.send 包装，用于调用外部 API
//   - auth:  当前登录用户（RecordModel | null）
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
  const mine = ctx.auth ? ctx.app.findRecordsByFilter('tasks', `owner = "${ctx.auth.id}"`, '', -1, 0).length : 0
  return { total, done, mine }
}
