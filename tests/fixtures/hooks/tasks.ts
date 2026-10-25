// e2e 夹具：tasks 服务的 JSVM hooks 与 action
export function beforeValidate(ctx: any) {
  const title = String(ctx.record.get('title') ?? '').trim()
  if (!title) throw new BadRequestError('title 不能为空')
  ctx.record.set('title', title)
}

export function afterCreate(ctx: any) {
  ctx.log('created', ctx.record.id)
}

export function stats(ctx: any) {
  const total = ctx.app.countRecords('tasks')
  const done = ctx.app.findRecordsByFilter('tasks', 'done = true', '', -1, 0).length
  const mine = ctx.auth ? ctx.app.findRecordsByFilter('tasks', `owner = "${ctx.auth.id}"`, '', -1, 0).length : 0
  return { total, done, mine }
}

class BadRequestError extends Error {}
