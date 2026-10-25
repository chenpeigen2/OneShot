// 套件 6：oneshot doctor 一键体检（R1 AC-1~AC-10；放在套件列表末尾——
// 会临时修改夹具 config 并向主 hooks 目录写孤儿文件，均按"读原文 → 改 → 跑 → 恢复"包络自恢复）。
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PB, CTRL, assert, summary, superuserLogin, j } from '../helpers.mjs'

const CLI = process.env.TEST_CLI
const FIXTURE = process.env.TEST_FIXTURE_DIR || 'tests/.tmp/project'
const HOOKS = process.env.TEST_MAIN_HOOKS_DIR || 'tests/.tmp/hooks_main'
const PB_BIN = process.env.TEST_PB_BIN
const TMP = process.env.TEST_TMP || 'tests/.tmp'
const CONFIG = join(FIXTURE, 'oneshot.config.ts')

// 与 runner 跑 publish 一致的环境注入（doctor 绝不读 stdin，凭据缺失也只 warn）
const ENV = {
  ...process.env,
  ONESHOT_PB_URL: PB,
  ONESHOT_SIDECAR_URL: CTRL,
  ONESHOT_SUPERUSER_EMAIL: 'admin@example.com',
  ONESHOT_SUPERUSER_PASSWORD: 'oneshot123',
}

/** spawnSync 跑 doctor --json；返回进程结果 + 解析后的 JSON（解析失败为 null） */
function runDoctorJson(args, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, 'doctor', '--json', ...args], {
    encoding: 'utf8', env: ENV, timeout: 60000, ...opts,
  })
  let json = null
  try { json = JSON.parse(res.stdout) } catch { /* stdout 不是单个 JSON 文档（FR-9 协议破坏） */ }
  return { res, json }
}
const statusOf = (report, id) => report?.checks?.find((c) => c.id === id)?.status

// ---------- AC-1 前置：重新发布夹具，保证快照新鲜（模式同 env-collections 套件） ----------
execFileSync(process.execPath, [CLI, 'publish', '--config', CONFIG, '--no-gen', '--hooks-dir', HOOKS], {
  env: ENV, stdio: 'pipe',
})

// ---------- AC-1 正常路径全绿（cwd = 夹具目录，走 findConfig 默认查找链） ----------
const base = runDoctorJson(['--hooks-dir', HOOKS, '--engine', PB_BIN], { cwd: FIXTURE })
assert('doctor: 正常路径退出码 0', base.res.status === 0, `status=${base.res.status} stderr=${base.res.stderr}`)
assert('doctor: --json 可解析且 project/target/ok 正确',
  base.json?.project === 'e2e-fixture' && base.json?.target === PB && base.json?.ok === true, base.res.stdout)
const ids = base.json?.checks?.map((c) => c.id).join(',') ?? ''
const sixOk = ['config', 'engine', 'connectivity', 'credentials', 'snapshot', 'hooks']
  .every((id) => statusOf(base.json, id) === 'ok')
assert('doctor: checks 固定顺序且六项全 ok', ids === 'config,engine,connectivity,credentials,snapshot,hooks,disk' && sixOk, ids)

// ---------- AC-2 快照一致性：doctor 本地 hash === PB oneshot_meta 记录的 hash ----------
const token = await superuserLogin(PB)
const meta = await j(PB, 'GET',
  `/api/collections/oneshot_meta/records?filter=${encodeURIComponent('project = "e2e-fixture"')}&perPage=1`, undefined, token)
const remoteHash = meta.data?.items?.[0]?.snapshot?.hash
const localHash = base.json?.checks?.find((c) => c.id === 'snapshot')?.hash
assert('snapshot: 本地 hash 与 PB oneshot_meta 字符串相等', typeof remoteHash === 'string' && localHash === remoteHash,
  `local=${localHash} remote=${remoteHash}`)

// ---------- AC-9 引擎版本可见 ----------
const version = base.json?.checks?.find((c) => c.id === 'engine')?.version ?? ''
assert('engine: version 非空且以 v 开头', /^v\d/.test(version), version)

// ---------- AC-10 磁盘信息项 ----------
const disk = base.json?.checks?.find((c) => c.id === 'disk')
assert('disk: bytes ≥ 0 且 status ∈ {ok, warn}',
  typeof disk?.bytes === 'number' && disk.bytes >= 0 && ['ok', 'warn'].includes(disk.status), JSON.stringify(disk))

// ---------- AC-3 漂移告警：改 config 不发布 → snapshot warn；warn 不影响退出码；finally 恢复 ----------
const original = readFileSync(CONFIG, 'utf8')
try {
  writeFileSync(CONFIG, original.replace("title: '任务'", "title: '任务x'"), 'utf8')
  const drift = runDoctorJson(['--hooks-dir', HOOKS, '--engine', PB_BIN], { cwd: FIXTURE })
  const snap = drift.json?.checks?.find((c) => c.id === 'snapshot')
  assert('drift: snapshot warn 且 detail 含"漂移"，退出码仍 0',
    snap?.status === 'warn' && snap.detail.includes('漂移') && drift.res.status === 0, JSON.stringify(snap))
} finally {
  writeFileSync(CONFIG, original, 'utf8')
}

// ---------- AC-4 引擎缺失降级 warn：无 --engine 且在无 .oneshot/ 的临时 cwd ----------
const bareCwd = join(TMP, 'doctor-bare-cwd')
mkdirSync(bareCwd, { recursive: true })
const noEngine = runDoctorJson(['--config', CONFIG, '--hooks-dir', HOOKS], { cwd: bareCwd })
const engineCheck = noEngine.json?.checks?.find((c) => c.id === 'engine')
assert('engine: 无 --engine 无 .oneshot 降级 warn 且退出码 0', engineCheck?.status === 'warn' && noEngine.res.status === 0,
  JSON.stringify(engineCheck))
rmSync(bareCwd, { recursive: true, force: true })

// ---------- AC-5 不可达实例：discard 端口 → connectivity fail + credentials/snapshot skip + 退出码 1 ----------
const unreachable = runDoctorJson(['--config', CONFIG, '--hooks-dir', HOOKS, '--engine', PB_BIN, '--url', 'http://127.0.0.1:9'])
assert('unreachable: connectivity fail + credentials/snapshot skip + 退出码 1',
  statusOf(unreachable.json, 'connectivity') === 'fail'
  && statusOf(unreachable.json, 'credentials') === 'skip'
  && statusOf(unreachable.json, 'snapshot') === 'skip'
  && unreachable.res.status === 1,
  JSON.stringify(unreachable.json?.checks?.map((c) => [c.id, c.status])))

// ---------- AC-6 错误凭据：密码错误 → credentials fail + snapshot skip + 退出码 1 ----------
const badCreds = runDoctorJson(['--config', CONFIG, '--hooks-dir', HOOKS, '--engine', PB_BIN], {
  env: { ...ENV, ONESHOT_SUPERUSER_PASSWORD: 'definitely-wrong' },
})
assert('bad credentials: credentials fail + snapshot skip + 退出码 1',
  statusOf(badCreds.json, 'credentials') === 'fail'
  && statusOf(badCreds.json, 'snapshot') === 'skip'
  && badCreds.res.status === 1,
  JSON.stringify(badCreds.json?.checks?.map((c) => [c.id, c.status])))

// ---------- AC-7 坏 manifest：副本加非法字段名 → config fail（detail 含"非法"）+ 三项 skip + 退出码 1 ----------
const badDir = join(TMP, 'bad-project')
rmSync(badDir, { recursive: true, force: true })
cpSync(FIXTURE, badDir, { recursive: true })
const badOriginal = readFileSync(join(badDir, 'oneshot.config.ts'), 'utf8')
writeFileSync(join(badDir, 'oneshot.config.ts'),
  badOriginal.replace(
    'title: s.text({ required: true, max: 200, presentable: true }),',
    "title: s.text({ required: true, max: 200, presentable: true }),\n            'Bad Name': s.text({}),",
  ), 'utf8')
const badManifest = runDoctorJson(['--config', join(badDir, 'oneshot.config.ts'), '--engine', PB_BIN])
const badConfig = badManifest.json?.checks?.find((c) => c.id === 'config')
assert('bad manifest: config fail 且 detail 含"非法"', badConfig?.status === 'fail' && badConfig.detail.includes('非法'),
  JSON.stringify(badConfig))
assert('bad manifest: connectivity/credentials/snapshot 全 skip 且退出码 1',
  statusOf(badManifest.json, 'connectivity') === 'skip'
  && statusOf(badManifest.json, 'credentials') === 'skip'
  && statusOf(badManifest.json, 'snapshot') === 'skip'
  && badManifest.res.status === 1,
  JSON.stringify(badManifest.json?.checks?.map((c) => [c.id, c.status])))
rmSync(badDir, { recursive: true, force: true })

// ---------- AC-8 孤儿 hooks 告警与恢复（主实例不热加载 hooks 目录，占位文件无运行时副作用） ----------
const orphanFile = join(HOOKS, 'ghost_orphan.user.pb.js')
writeFileSync(orphanFile, 'x', 'utf8')
const withOrphan = runDoctorJson(['--hooks-dir', HOOKS, '--engine', PB_BIN], { cwd: FIXTURE })
const orphanCheck = withOrphan.json?.checks?.find((c) => c.id === 'hooks')
assert('orphans: hooks warn 且 orphans 数组包含 ghost_orphan.user.pb.js',
  orphanCheck?.status === 'warn' && Array.isArray(orphanCheck.orphans) && orphanCheck.orphans.includes('ghost_orphan.user.pb.js'),
  JSON.stringify(orphanCheck))
rmSync(orphanFile, { force: true })
const cleaned = runDoctorJson(['--hooks-dir', HOOKS, '--engine', PB_BIN], { cwd: FIXTURE })
assert('orphans: 清理后 hooks 恢复 ok', statusOf(cleaned.json, 'hooks') === 'ok',
  JSON.stringify(cleaned.json?.checks?.find((c) => c.id === 'hooks')))

summary('doctor')
