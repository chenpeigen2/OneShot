// 套件：种子数据（manifest seeds → publish 幂等灌入 → relation 查找解析 → 校验拒绝）
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { PB, assert, summary, superuserLogin, j, makeUser } from '../helpers.mjs'

const CLI = process.env.TEST_CLI
const TMP = process.env.TEST_TMP || 'tests/.tmp'
const HOOKS = process.env.TEST_MAIN_HOOKS_DIR
const suToken = await superuserLogin(PB)
const H = { 'Content-Type': 'application/json', Authorization: suToken }
const env = { ...process.env, ONESHOT_PB_URL: PB, ONESHOT_SUPERUSER_EMAIL: 'admin@example.com', ONESHOT_SUPERUSER_PASSWORD: 'oneshot123' }

// 独立小项目：seed_demo 服务（避免污染夹具的 tasks）
const proj = join(TMP, 'seed-project')
rmSync(proj, { recursive: true, force: true })
mkdirSync(join(proj, 'node_modules/@oneshot'), { recursive: true })
symlinkSync(process.env.TEST_CORE_DIR ? join(process.env.TEST_CORE_DIR) : join(process.cwd(), 'packages/core'), join(proj, 'node_modules/@oneshot/core'), process.platform === 'win32' ? 'junction' : 'dir')

const demoUser = await makeUser(PB)

writeFileSync(join(proj, 'oneshot.config.ts'), `import { defineConfig, s, service } from '@oneshot/core'
export default defineConfig({
  name: 'seed-demo',
  baseUrl: '${PB}',
  services: [
    service('seedsvc', {
      collections: {
        seed_labels: {
          fields: {
            slug: s.text({ required: true, presentable: true }),
            color: s.text(),
          },
          seeds: [
            { __key: 'slug', slug: 'welcome', color: 'amber' },
            { __key: 'slug', slug: 'beta', color: 'zinc' },
          ],
        },
        seed_notes: {
          fields: {
            title: s.text({ required: true }),
            owner: s.relation('users', { required: true }),
          },
          seeds: [
            { __key: 'title', title: 'seeded-note', owner: { __collection: 'users', __filter: 'email = "${demoUser.email}"' } },
          ],
        },
      },
    }),
  ],
})
`)

// CLI 日志走 stderr：用 spawnSync 才能在成功时也拿到（execFileSync 成功时不返回 stderr）
const publish = (extra = []) => {
  const res = spawnSync(process.execPath,
    [CLI, 'publish', '--config', join(proj, 'oneshot.config.ts'), '--no-gen', '--hooks-dir', HOOKS, ...extra],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env })
  if (res.status !== 0) throw new Error(`publish 失败：${res.stderr}`)
  return res.stdout + res.stderr
}

// ---------- 首次发布：种子灌入 ----------
const out1 = publish()
assert('seeds: 首次发布灌入 3 条种子', (out1.match(/种子已灌入/g) ?? []).length === 3, out1.split('\n').filter(l => l.includes('种子')).join(';'))
const seed_labels = await j(PB, 'GET', '/api/collections/seed_labels/records?perPage=10', undefined, suToken)
assert('seeds: seed_labels 两条（welcome/beta）', seed_labels.data.totalItems === 2
  && seed_labels.data.items.some((r) => r.slug === 'welcome' && r.color === 'amber'), JSON.stringify(seed_labels.data.items?.map((r) => r.slug)))
const seed_notes = await j(PB, 'GET', '/api/collections/seed_notes/records?perPage=10', undefined, suToken)
assert('seeds: relation 查找解析（owner = demo 用户 id）', seed_notes.data.totalItems === 1 && seed_notes.data.items[0].owner === demoUser.id,
  JSON.stringify(seed_notes.data.items?.[0]?.owner))

// ---------- 幂等重放：不重复、不更新 ----------
const out2 = publish()
assert('seeds: 幂等重放零灌入', (out2.match(/种子已灌入/g) ?? []).length === 0, out2.split('\n').filter(l => l.includes('种子')).join(';'))
const seed_labels2 = await j(PB, 'GET', '/api/collections/seed_labels/records?perPage=10', undefined, suToken)
assert('seeds: 重放后仍只有 2 条', seed_labels2.data.totalItems === 2)

// 修改种子值不覆盖已有数据（幂等 = 存在即跳过）
const cfgPath = join(proj, 'oneshot.config.ts')
writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replace("color: 'amber'", "color: 'changed'"))
publish()
const seed_labels3 = await j(PB, 'GET', '/api/collections/seed_labels/records?perPage=10', undefined, suToken)
const welcome = seed_labels3.data.items.find((r) => r.slug === 'welcome')
assert('seeds: 已存在种子不被更新（防覆盖既有数据）', welcome.color === 'amber', welcome.color)

// ---------- 校验拒绝 ----------
writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replace("{ __key: 'slug', slug: 'beta', color: 'zinc' },", "{ slug: 'beta', color: 'zinc' },"))
let rejected = false
try { publish(); rejected = false } catch (e) { rejected = String(e.message).includes('__key') || String(e.message).includes('缺少') }
assert('seeds: 缺 __key 的种子被校验拒绝', rejected)
const seed_labels4 = await j(PB, 'GET', '/api/collections/seed_labels/records?perPage=10', undefined, suToken)
assert('seeds: 拒绝后数据无变化', seed_labels4.data.totalItems === 2)

// ---------- 清理 ----------
for (const c of ['seed_labels', 'seed_notes']) {
  const coll = await j(PB, 'GET', `/api/collections/${c}`, undefined, suToken)
  if (coll.data?.id) await j(PB, 'DELETE', `/api/collections/${coll.data.id}`, undefined, suToken)
}
const meta = await j(PB, 'GET', '/api/collections/oneshot_meta/records?perPage=50&filter=' + encodeURIComponent('project = "seed-demo"'), undefined, suToken)
for (const item of meta.data.items ?? []) await j(PB, 'DELETE', `/api/collections/oneshot_meta/records/${item.id}`, undefined, suToken)
rmSync(proj, { recursive: true, force: true })
const after = await j(PB, 'GET', '/api/collections?perPage=200', undefined, suToken)
assert('seeds: 清理后无 seed_labels/seed_notes 残留', !(after.data.items ?? []).some((c) => ['seed_labels', 'seed_notes'].includes(c.name)))

summary('seeds')
