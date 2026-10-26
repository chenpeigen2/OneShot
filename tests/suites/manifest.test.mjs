// 套件 3：manifest 读 → 改 → 写回 → 发布生效 → 幂等 → 非法拒绝 → .bak 备份
// 注意：控制服务器（TEST_CTRL）以 tests/.tmp/manifest-project 为其 manifest，写回发生在该副本上。
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { PB, CTRL, assert, summary, superuserLogin, j } from '../helpers.mjs'

const CLI = process.env.TEST_CLI || 'packages/cli/dist/index.js'

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

// ---------- actions 编辑覆盖：manifest API 加减含 action 的服务，PB 侧路由随之生灭 ----------
const HOOKS_DIR = process.env.TEST_MAIN_HOOKS_DIR

/** 轮询等待路由达到期望状态码（热重载有 1-2 秒窗口，期间可能连接被拒或仍旧路由） */
async function waitRouteStatus(urlPath, wantStatus, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let stable = 0
  for (;;) {
    try {
      const res = await fetch(PB + urlPath, { signal: AbortSignal.timeout(1500) })
      stable = res.status === wantStatus ? stable + 1 : 0
      if (stable >= 3) return true
    } catch { stable = 0 }
    if (Date.now() > deadline) return false
    await new Promise((r) => setTimeout(r, 250))
  }
}

const publishToMainHooks = () => execFileSync(process.execPath, [CLI, 'publish', '--config', join(dirname(path), 'oneshot.config.ts'), '--no-gen', '--hooks-dir', HOOKS_DIR], {
  env: { ...process.env, ONESHOT_PB_URL: PB, ONESHOT_SIDECAR_URL: CTRL,
    ONESHOT_SUPERUSER_EMAIL: 'admin@example.com', ONESHOT_SUPERUSER_PASSWORD: 'oneshot123' },
  stdio: 'pipe',
})

async function coldRestartMain() {
  const request = String(Date.now())
  writeFileSync(process.env.TEST_RESTART_MAIN, request)
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (readFileSync(process.env.TEST_RESTART_ACK, 'utf8') === request) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

// handler 源文件写入 manifest 副本项目（validateConfig 要求 handler 文件存在；套件自清理）
const handlerFile = join(dirname(path), 'hooks', 'actions.ts')
writeFileSync(handlerFile, "export function hello() {\n  return { hello: 'world', source: 'e2e-actions' }\n}\n", 'utf8')

const { config: baseCfg } = await fetch(CTRL + '/api/manifest', { headers: H }).then((r) => r.json())
const svcWithAction = (handler) => ({
  name: 'e2e_actions',
  collections: { action_notes: { fields: { title: { kind: 'text', options: {} } } } },
  actions: { hello: { method: 'GET', rule: 'public', handler } },
})
const withActions = JSON.parse(JSON.stringify(baseCfg))
withActions.services.push(svcWithAction('./hooks/actions.ts#hello'))
const addedSvc = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: withActions }) }).then((r) => r.json())
assert('actions: 新增含 action 的服务并发布', addedSvc.report?.created?.includes('action_notes'), JSON.stringify(addedSvc))

// 新增路由依赖 hooks 冷启动加载，不依赖 PB 在 Windows 上不可靠的新文件热重载
publishToMainHooks()
if (!(await coldRestartMain())) throw new Error('主实例冷重启超时')
await waitRouteStatus('/api/oneshot/e2e_actions/hello', 200)
const hello = await j(PB, 'GET', '/api/oneshot/e2e_actions/hello')
assert('actions: PB 路由可用且返回 handler 结果', hello.status === 200 && hello.data?.hello === 'world', JSON.stringify(hello.data))

// 缺失 handler 的非法 action 在写回前被拒（文件不被破坏）
const badAct = JSON.parse(JSON.stringify(baseCfg))
badAct.services.push(svcWithAction('./hooks/definitely-missing.ts#x'))
const badActRes = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: badAct }) }).then((r) => r.json())
assert('actions: 缺失 handler 的非法 action 被拒', !!badActRes.error?.includes('找不到') && !badActRes.report, JSON.stringify(badActRes))

// 删除该服务 → manifest 恢复原状，路由随之消失
const removedSvc = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: baseCfg }) }).then((r) => r.json())
assert('actions: 服务从 manifest 删除成功', !!removedSvc.report && !removedSvc.error, JSON.stringify(removedSvc))
publishToMainHooks()
// publish 只清理"上一次快照有、本次没有"的服务的产物（且在发布方 hooksDir 语义下），主实例里的孤儿产物这里手工清
rmSync(join(HOOKS_DIR, 'e2e_actions.pb.js'), { force: true })
rmSync(join(HOOKS_DIR, 'e2e_actions.user.pb.js'), { force: true })
if (!(await coldRestartMain())) throw new Error('主实例冷重启超时')
await waitRouteStatus('/api/oneshot/e2e_actions/hello', 404)
const gone = await j(PB, 'GET', '/api/oneshot/e2e_actions/hello')
assert('actions: 删除服务后路由 404', gone.status === 404, `status=${gone.status}`)

// 清理：manifest 删除不删 PB collection（防误删语义），套件直接删掉测试 collection 与 handler 文件
const delColl = await j(PB, 'DELETE', '/api/collections/action_notes', undefined, H.Authorization)
rmSync(handlerFile, { force: true })
assert('actions: 测试 collection 已清理', [200, 204, 404].includes(delColl.status), `status=${delColl.status}`)

// ---------- 对抗加固：写回限额（413/415）与非法 service/环境键拒绝且不落盘 ----------
const srcBeforeHardening = readFileSync(path, 'utf8')

// POST body 超 2MB → 413
const tooBigBody = JSON.stringify({ config: { ...baseCfg, _pad: 'A'.repeat(2 * 1024 * 1024 + 64) } })
const tooBig = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: tooBigBody }).then((r) => r.status)
assert('限额: >2MB 写回被 413 拒绝', tooBig === 413, `status=${tooBig}`)

// 非 JSON Content-Type → 415
const wrongCT = await fetch(CTRL + '/api/manifest', {
  method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: JSON.stringify({ config: baseCfg }),
}).then((r) => r.status)
assert('限额: text/plain 写回被 415 拒绝', wrongCT === 415, `status=${wrongCT}`)

// service 名路径穿越 → validateConfig 拒绝（400），且文件未被改写
const evil = JSON.parse(JSON.stringify(baseCfg))
evil.services.push({ name: '../evil', collections: { t: { fields: { a: { kind: 'text', options: {} } } } } })
const evilRes = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: evil }) }).then((r) => r.json())
assert('校验: service 名 "../evil" 被拒', evilRes.error?.includes('非法') && !evilRes.report, JSON.stringify(evilRes))

// 环境键带连字符（写回后不是合法标识符）→ 拒绝，且文件未被改写
const badEnv = JSON.parse(JSON.stringify(baseCfg))
badEnv.environments = { ...(badEnv.environments ?? {}), 'prod-1': { baseUrl: 'http://127.0.0.1:9' } }
const badEnvRes = await fetch(CTRL + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: badEnv }) }).then((r) => r.json())
assert('校验: 环境键 "prod-1" 被拒', badEnvRes.error?.includes('环境键名') && !badEnvRes.report, JSON.stringify(badEnvRes))
assert('校验: 两类拒绝均未落盘', readFileSync(path, 'utf8') === srcBeforeHardening)

summary('manifest')
