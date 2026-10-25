// 套件 3：manifest 读 → 改 → 写回 → 发布生效 → 幂等 → 非法拒绝 → .bak 备份
// 注意：控制服务器（TEST_CTRL）以 tests/.tmp/manifest-project 为其 manifest，写回发生在该副本上。
import { readFileSync } from 'node:fs'
import { PB, CTRL, assert, summary, superuserLogin, j } from '../helpers.mjs'

const H = { 'Content-Type': 'application/json', Authorization: await superuserLogin(PB) }

// 无 token 被拒
const noAuth = await fetch(CTRL + '/api/manifest').then((r) => r.status)
assert('manifest: 无 token 被拒', noAuth === 401, `status=${noAuth}`)

// 读
const { config, path } = await fetch(CTRL + '/api/manifest', { headers: H }).then((r) => r.json())
assert('manifest: 读取成功', config?.name === 'e2e-fixture' && Array.isArray(config.services), path)

// 改：tasks 加字段 + list 规则改 authenticated
const draft = JSON.parse(JSON.stringify(config))
const tasks = draft.services.find((s) => s.name === 'tasks').collections.tasks
tasks.fields.e2e_field = { kind: 'text', options: { max: 100 } }
const rulesBefore = tasks.rules.list
tasks.rules.list = 'authenticated'
const saved = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: draft }) }).then((r) => r.json())
assert('manifest: 写回并发布成功', saved.report && saved.report.updated.includes('tasks'), JSON.stringify(saved))

// PB 生效
const coll = await j(PB, 'GET', '/api/collections/tasks', undefined, H.Authorization)
assert('PB: e2e_field 已生效', coll.data.fields?.some((f) => f.name === 'e2e_field'))
assert('PB: list 规则已更新', coll.data.listRule === '@request.auth.id != ""', coll.data.listRule)

// 写回的文件合法且包含新字段；.bak 是旧版
const src = readFileSync(path, 'utf8')
assert('文件: 写回的 TS 包含 e2e_field', src.includes("e2e_field: s.text(") && src.includes("max: 100"))
assert('文件: .bak 备份存在且是旧版', readFileSync(path + '.bak', 'utf8').includes('e2e_field') === false)

// 幂等
const again = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: draft }) }).then((r) => r.json())
assert('幂等: 二次写回全 unchanged', again.report && again.report.updated.length === 0 && again.report.created.length === 0, JSON.stringify(again.report))

// 非法输入拒绝且文件未被破坏
const bad = JSON.parse(JSON.stringify(draft))
bad.services[0].collections.tasks.fields['Bad Name'] = { kind: 'text', options: {} }
const badRes = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: bad }) }).then((r) => r.json())
assert('校验: 非法字段名被拒', badRes.error?.includes('非法'), JSON.stringify(badRes))
assert('校验: 拒绝后文件仍是合法状态', readFileSync(path, 'utf8').includes('e2e_field'))

// 还原
const restored = JSON.parse(JSON.stringify(draft))
const rt = restored.services.find((s) => s.name === 'tasks').collections.tasks
delete rt.fields.e2e_field
rt.rules.list = rulesBefore
await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: restored }) })
const coll2 = await j(PB, 'GET', '/api/collections/tasks', undefined, H.Authorization)
assert('还原: 规则恢复 + 字段保留（防误删设计）', coll2.data.fields?.some((f) => f.name === 'e2e_field') && coll2.data.listRule?.includes('owner = @request.auth.id'))

summary('manifest')
