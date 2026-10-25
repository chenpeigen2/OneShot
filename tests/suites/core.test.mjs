// 套件 1：核心能力（注册登录/owner 规则隔离/hooks 生命周期与默认值/jsvm action/filter/sort/meta）
import { PB, assert, summary, j, makeUser } from '../helpers.mjs'

const su = { token: await (async () => (await fetch(PB + '/api/collections/_superusers/auth-with-password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: 'admin@example.com', password: 'oneshot123' }),
}).then((r) => r.json())).token)() }

const a = await makeUser()
const b = await makeUser()
const tokA = a.token
const tokB = b.token

// owner create 规则 + 默认值 + trim 钩子
const t1 = await j(PB, 'POST', '/api/collections/tasks/records', { title: '  买咖啡  ', owner: a.id }, tokA)
assert('A 创建自己的任务（owner create 规则）', t1.status === 200, JSON.stringify(t1.data))
assert('hooks: beforeValidate 裁剪 title', t1.data.title === '买咖啡', `got "${t1.data?.title}"`)
assert('hooks: 默认值 done=false', t1.data.done === false, `got ${t1.data?.done}`)
assert('hooks: 默认值 priority=0', t1.data.priority === 0, `got ${t1.data?.priority}`)

// 冒充 owner 被拒
const t2 = await j(PB, 'POST', '/api/collections/tasks/records', { title: 'x', owner: b.id }, tokA)
assert('create 规则拒绝冒充 owner', t2.status === 400, `status=${t2.status}`)

// 空标题被钩子拒绝
const t3 = await j(PB, 'POST', '/api/collections/tasks/records', { title: '   ', owner: a.id }, tokA)
assert('hooks/校验: 空标题被拒绝', t3.status === 400, JSON.stringify(t3.data))

// list/view 规则隔离
const listA = await j(PB, 'GET', '/api/collections/tasks/records', undefined, tokA)
assert('list 规则：A 看到自己的任务', listA.status === 200 && listA.data.totalItems === 1, `total=${listA.data?.totalItems}`)
const listB = await j(PB, 'GET', '/api/collections/tasks/records', undefined, tokB)
assert('list 规则：B 看不到 A 的任务', listB.status === 200 && listB.data.totalItems === 0, `total=${listB.data?.totalItems}`)
const viewB = await j(PB, 'GET', `/api/collections/tasks/records/${t1.data.id}`, undefined, tokB)
assert('view 规则：B 不能读 A 的单条', viewB.status === 404, `status=${viewB.status}`)
const anon = await j(PB, 'GET', '/api/collections/tasks/records')
assert('list 规则：匿名不可见', anon.status === 200 && anon.data.totalItems === 0, `total=${anon.data?.totalItems}`)

// jsvm action：requireAuth 中间件 + handler
const noAuth = await j(PB, 'GET', '/api/oneshot/tasks/stats')
assert('action: 未登录被中间件拒绝', noAuth.status === 401 || noAuth.status === 403, `status=${noAuth.status}`)
const stats = await j(PB, 'GET', '/api/oneshot/tasks/stats', undefined, tokA)
assert('action: stats 返回 {total, done, mine}', stats.status === 200 && stats.data.total === 1 && stats.data.mine === 1, JSON.stringify(stats.data))

// filter/sort
await j(PB, 'POST', '/api/collections/tasks/records', { title: '第二件事', done: true, tags: ['work'], owner: a.id }, tokA)
const fl = await j(PB, 'GET', '/api/collections/tasks/records?filter=' + encodeURIComponent('done = true'), undefined, tokA)
assert('filter 查询', fl.status === 200 && fl.data.totalItems === 1 && fl.data.items[0].title === '第二件事', JSON.stringify(fl.data?.totalItems))
const srt = await j(PB, 'GET', '/api/collections/tasks/records?sort=-created', undefined, tokA)
assert('sort 查询', srt.status === 200 && srt.data.items[0].title === '第二件事')

// meta 快照
const meta = await j(PB, 'GET', '/api/collections/oneshot_meta/records', undefined, su.token)
assert('oneshot_meta 快照已写入', meta.status === 200 && meta.data.items[0]?.snapshot?.hash, JSON.stringify(meta.data?.items?.[0]?.snapshot?.hash))

summary('core')
