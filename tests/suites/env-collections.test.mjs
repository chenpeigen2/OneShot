// 套件 4：collection 增删（manifest API 语义）+ 多环境发布（--env staging → 第二实例）
import { execFileSync } from 'node:child_process'
import { PB, STAGING, assert, summary, superuserLogin, j } from '../helpers.mjs'

const CLI = process.env.TEST_CLI || '/Users/chenpeigen/code/OneShot/packages/cli/dist/index.js'
const FIXTURE = process.env.TEST_FIXTURE_DIR || 'tests/.tmp/project'
const H = { 'Content-Type': 'application/json', Authorization: await superuserLogin(PB) }

// ---------- collection 增删 ----------
const { config } = await fetch((process.env.TEST_CTRL || 'http://127.0.0.1:7861') + '/api/manifest', { headers: H }).then((r) => r.json())
const draft = JSON.parse(JSON.stringify(config))
draft.services[0].collections.labels = {
  fields: {
    name: { kind: 'text', options: { required: true, presentable: true } },
    color: { kind: 'select', options: { values: ['red', 'green', 'blue'] } },
  },
  rules: { list: 'authenticated', view: 'authenticated' },
}
const added = await fetch((process.env.TEST_CTRL || 'http://127.0.0.1:7861') + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: draft }) }).then((r) => r.json())
assert('collection: 新增并发布', added.report?.created.includes('labels'), JSON.stringify(added.report))
const prodColls = await j(PB, 'GET', '/api/collections?perPage=200', undefined, H.Authorization)
assert('collection: PB 已创建 labels', prodColls.data.items?.some((c) => c.name === 'labels'))

// 从 manifest 删除 → PB 保留（防误删语义）
const draft2 = JSON.parse(JSON.stringify(draft))
delete draft2.services[0].collections.labels
const removed = await fetch((process.env.TEST_CTRL || 'http://127.0.0.1:7861') + '/api/manifest', { method: 'POST', headers: H, body: JSON.stringify({ config: draft2 }) }).then((r) => r.json())
assert('collection: 从 manifest 删除成功（无 prune 不删 PB）', removed.report && !removed.report.pruned?.length, JSON.stringify(removed.report))
const prodColls2 = await j(PB, 'GET', '/api/collections?perPage=200', undefined, H.Authorization)
assert('collection: PB 侧 labels 保留（防误删）', prodColls2.data.items?.some((c) => c.name === 'labels'))

// ---------- 多环境：--env staging 发布到第二实例 ----------
// 夹具已声明 environments.staging → TEST_STAGING；用 CLI 发布
execFileSync(process.execPath, [CLI, 'publish', '--config', `${FIXTURE}/oneshot.config.ts`, '--env', 'staging', '--no-gen',
  '--hooks-dir', `${FIXTURE}/../staging-hooks`], {
  env: { ...process.env, ONESHOT_SUPERUSER_EMAIL: 'admin@example.com', ONESHOT_SUPERUSER_PASSWORD: 'oneshot123' },
  stdio: 'pipe',
})
// 注意：staging 发布会把钩子写到独立目录（staging 实例由 runner 管理生命周期）
const stToken = await superuserLogin(STAGING)
const stColls = await j(STAGING, 'GET', '/api/collections?perPage=200', undefined, stToken)
const names = stColls.data.items?.filter((c) => !c.system).map((c) => c.name) ?? []
assert('多环境: staging 实例收到完整发布', names.includes('tasks') && names.includes('oneshot_meta'), names.join(','))
const stMeta = await j(STAGING, 'GET', '/api/collections/oneshot_meta/records', undefined, stToken)
assert('多环境: staging 快照写入', stMeta.status === 200 && stMeta.data.items[0]?.snapshot?.hash, JSON.stringify(stMeta.data?.items?.[0]?.snapshot?.hash))

// 未知环境报错
let unknownEnvFailed = false
try {
  execFileSync(process.execPath, [CLI, 'publish', '--config', `${FIXTURE}/oneshot.config.ts`, '--env', 'nope', '--no-gen'], {
  stdio: 'pipe',
  env: { ...process.env, ONESHOT_SUPERUSER_EMAIL: 'admin@example.com', ONESHOT_SUPERUSER_PASSWORD: 'oneshot123' },
})
} catch { unknownEnvFailed = true }
assert('多环境: 未知环境报错', unknownEnvFailed)

summary('env-collections')
