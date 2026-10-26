// 套件 1：核心能力（注册登录/owner 规则隔离/hooks 生命周期与默认值/jsvm action/filter/sort/meta）
import { PB, assert, summary, j, makeUser, superuserLogin } from '../helpers.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const su = { token: await superuserLogin(PB) }

const a = await makeUser()
const b = await makeUser()
const tokA = a.token
const tokB = b.token
const me = await j(PB, 'GET', `/api/collections/users/records/${a.id}`, undefined, tokA)
assert('auth 自定义字段及非零默认值生效', me.data.role === 'reader' && me.data.maxBorrow === 5, JSON.stringify(me.data))
const { buildAuthCollectionCreate, managedCreateLock, managedUpdateLock } = await import(pathToFileURL(join(process.env.TEST_CORE_DIR ?? 'packages/core', 'dist/index.js')).href)
const authMapping = buildAuthCollectionCreate('users', 'public', {}, { createRule: '@request.body.role = "reader"' })
assert('auth createRule 覆盖公开注册默认值', authMapping.createRule === '@request.body.role = "reader"', JSON.stringify(authMapping))

// 托管字段：注册只提交账号即可，客户端不得改值；本人更新不得改托管字段
const managedFields = { role: { kind: 'select', options: { values: ['reader'], default: 'reader' } }, maxBorrow: { kind: 'number', options: { default: 5 } } }
const managedMapping = buildAuthCollectionCreate('users', 'public', managedFields, { managed: ['role', 'maxBorrow'] })
assert('managed createRule 允许省略托管字段', managedMapping.createRule.includes('@request.body.role = "" || @request.body.role = "reader"'), String(managedMapping.createRule))
assert('managed createRule 锁定默认值', managedMapping.createRule.includes('@request.body.maxBorrow = "" || @request.body.maxBorrow = 5'), String(managedMapping.createRule))
assert('managed updateRule 托管字段须与现值一致', managedMapping.updateRule.includes('@request.body.fines = "" || @request.body.fines = fines') === false && managedMapping.updateRule.includes('@request.body.maxBorrow = "" || @request.body.maxBorrow = maxBorrow'), String(managedMapping.updateRule))
assert('managed updateRule 放行系统服务账号', managedMapping.updateRule.includes('oneshot-service@system.local'), String(managedMapping.updateRule))
assert('managed 锁片段可单独复用', managedCreateLock(['role'], managedFields) === '(@request.body.role = "" || @request.body.role = "reader")' && managedUpdateLock(['role']) === '(@request.body.role = "" || @request.body.role = role)', managedCreateLock(['role'], managedFields))

// 注册只给账号密码 → 服务端补默认值；提交越权值被拒
const plain = await j(PB, 'POST', '/api/collections/users/records', { email: `plain-${Date.now()}@test.dev`, password: '1234567890', passwordConfirm: '1234567890' })
assert('公开注册只需账号密码', plain.status === 200 && plain.data.role === 'reader' && plain.data.maxBorrow === 5, JSON.stringify(plain.data))
const escalate = await j(PB, 'POST', '/api/collections/users/records', { email: `esc-${Date.now()}@test.dev`, password: '1234567890', passwordConfirm: '1234567890', role: 'librarian' })
assert('注册不能提交非默认受管字段', escalate.status === 400, `status=${escalate.status}`)
const selfBump = await j(PB, 'PATCH', `/api/collections/users/records/${a.id}`, { maxBorrow: 20 }, tokA)
assert('本人不能改托管字段', selfBump.status === 404, `status=${selfBump.status}`)
const fixtureDir = process.env.TEST_FIXTURE_DIR ?? 'tests/.tmp/project'
const tsSchema = readFileSync(join(fixtureDir, 'web/src/api/schema.ts'), 'utf8')
const reactClient = readFileSync(join(fixtureDir, 'web/src/api/react.tsx'), 'utf8')
const dartModels = readFileSync(join(fixtureDir, 'mobile/lib/api/models.dart'), 'utf8')
assert('TS 生成模型包含 auth 自定义字段与字面量联合', /interface UsersRecord[\s\S]*role: "reader" \| "librarian"[\s\S]*maxBorrow: number/.test(tsSchema))
assert('React 生成客户端共享 Provider 实例', reactClient.includes('export function useClient()') && reactClient.includes('() => client ?? createClient'))
assert('Dart 生成模型包含 auth 自定义字段', dartModels.includes('final String? role;') && dartModels.includes('final num maxBorrow;'))

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
