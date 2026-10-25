// 套件 2：sidecar action（PB→Node 转发链路）+ realtime SSE
import { PB, assert, summary, j, makeUser } from '../helpers.mjs'

// Node 下测 PB SDK realtime 需要 EventSource polyfill（浏览器端生成的 react.tsx 不需要）
const _es = await import('eventsource')
globalThis.EventSource = _es.EventSource ?? _es.default
const { default: PocketBase } = await import('pocketbase')

const a = await makeUser()
const tokA = a.token

// sidecar：未登录被 PB 中间件拒绝
const noAuth = await j(PB, 'GET', '/api/oneshot/tasks/summary')
assert('sidecar: 未登录被 PB 中间件拒绝', noAuth.status === 401 || noAuth.status === 403, `status=${noAuth.status}`)

// sidecar：PB→Node 转发 + 回调 PB API
const sum = await j(PB, 'GET', '/api/oneshot/tasks/summary', undefined, tokA)
assert('sidecar: summary 经 PB→Node 转发成功', sum.status === 200, JSON.stringify(sum.data))
assert('sidecar: 确认跑在 Node 进程', typeof sum.data.runtime === 'string' && sum.data.runtime.startsWith('node v'), JSON.stringify(sum.data?.runtime))
assert('sidecar: 回调 PB API 生效', Number.isInteger(sum.data.total), `total=${sum.data?.total}`)

// sidecar API 直访无 token 被拒（控制服务器端口由 TEST_CTRL 注入）
const CTRL = process.env.TEST_CTRL || 'http://127.0.0.1:7861'
const badToken = await fetch(CTRL + '/sidecar/tasks/summary').then((r) => r.status)
assert('sidecar: 直接访问 /sidecar/* 无 token 被拒', badToken === 401, `status=${badToken}`)

// sidecar 直访边界：未知 action 404、>1MB 413、非 JSON 415、合法 token 正向 200
const { readFileSync } = await import('node:fs')
const { join } = await import('node:path')
const sidecarToken = readFileSync(join(process.env.TEST_FIXTURE_DIR ?? 'tests/.tmp/project', '.oneshot', 'sidecar-token'), 'utf8').trim()
const HSC = { 'Content-Type': 'application/json', Authorization: `Bearer ${sidecarToken}` }

const unknownAction = await fetch(CTRL + '/sidecar/tasks/definitely-not-an-action', { method: 'POST', headers: HSC, body: '{}' }).then((r) => r.status)
assert('sidecar: 直访未知 action 404', unknownAction === 404, `status=${unknownAction}`)

const tooBigSidecar = await fetch(CTRL + '/sidecar/tasks/summary', {
  method: 'POST', headers: HSC, body: JSON.stringify({ body: { _pad: 'A'.repeat(1024 * 1024 + 64) } }),
}).then((r) => r.status)
assert('sidecar: 直访 >1MB 被 413 拒绝', tooBigSidecar === 413, `status=${tooBigSidecar}`)

const wrongCTSidecar = await fetch(CTRL + '/sidecar/tasks/summary', {
  method: 'POST', headers: { ...HSC, 'Content-Type': 'text/plain' }, body: 'x'.repeat(512 * 1024),
}).then((r) => r.status)
assert('sidecar: 直访 text/plain 被 415 拒绝', wrongCTSidecar === 415, `status=${wrongCTSidecar}`)

const directOk = await fetch(CTRL + '/sidecar/tasks/summary', { method: 'POST', headers: HSC, body: '{}' }).then((r) => r.json())
assert('sidecar: 直访合法 token 执行成功', directOk?.marker === 'from-sidecar', JSON.stringify(directOk))

// realtime：订阅 → 创建 → 收到事件
const pb = new PocketBase(PB)
const login = await j(PB, 'POST', '/api/collections/users/auth-with-password', { identity: a.email, password: '1234567890' })
pb.authStore.save(login.data.token, login.data.record)
let event = null
await pb.collection('tasks').subscribe('*', (e) => { event = e })
const created = await j(PB, 'POST', '/api/collections/tasks/records', { title: 'realtime 探针', owner: a.id }, tokA)
assert('realtime: 创建任务成功', created.status === 200)
for (let i = 0; i < 20 && !event; i++) await new Promise((r) => setTimeout(r, 150))
assert('realtime: 收到 create 事件', event?.action === 'create' && event?.record?.title === 'realtime 探针', JSON.stringify(event ? { action: event.action } : null))
await pb.collection('tasks').unsubscribe('*')

summary('sidecar-realtime')
