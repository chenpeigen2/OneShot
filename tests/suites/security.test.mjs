// 套件 7：sidecar 信任边界与凭据卫生（R2；放套件列表末尾，延续"污染型/依赖型套件最后"纪律）
// 对 fixture 只读（token 文件、config）；临时路径自建自删。权限断言仅 unix 语义（win32 守卫跳过）。
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PB, CTRL, assert, summary } from '../helpers.mjs'

const CLI = process.env.TEST_CLI
const FIXTURE = process.env.TEST_FIXTURE_DIR || 'tests/.tmp/project'
const TMP = process.env.TEST_TMP || 'tests/.tmp'
const CORE = process.env.TEST_CORE_DIR
const PB_BIN = process.env.TEST_PB_BIN
const HOOKS = process.env.TEST_MAIN_HOOKS_DIR

const TOKEN_PATH = join(FIXTURE, '.oneshot', 'sidecar-token')
const tokenValue = readFileSync(TOKEN_PATH, 'utf8').trim()

// 与 doctor 套件一致的真实凭据环境（AC-4 用；AC-3 反其道显式剔除）
const ENV = {
  ...process.env,
  ONESHOT_PB_URL: PB,
  ONESHOT_SUPERUSER_EMAIL: 'admin@example.com',
  ONESHOT_SUPERUSER_PASSWORD: 'oneshot123',
}
const mode = (p) => statSync(p).mode & 0o777

// ---------- AC-1 真实 token 母本权限不变式（runner 源头 0600/0700 + publish 自愈双兜底） ----------
if (process.platform !== 'win32') {
  assert('token: 母本文件权限 0600', mode(TOKEN_PATH) === 0o600, `mode=${mode(TOKEN_PATH).toString(8)}`)
  assert('token: 母本目录权限 0700', mode(join(FIXTURE, '.oneshot')) === 0o700, `mode=${mode(join(FIXTURE, '.oneshot')).toString(8)}`)
}

// ---------- AC-2 自愈行为：0644 token + 0755 目录 → 调用后权限纠正且值不轮换 ----------
if (process.platform !== 'win32') {
  const healRoot = join(TMP, 'security-heal-proj')
  rmSync(healRoot, { recursive: true, force: true })
  mkdirSync(join(healRoot, '.oneshot'), { recursive: true, mode: 0o755 })
  const T = `selfheal-${Math.random().toString(16).slice(2)}`
  writeFileSync(join(healRoot, '.oneshot', 'sidecar-token'), T) // 默认 0644
  const { getOrCreateSidecarToken } = await import(pathToFileURL(join(CORE, 'dist', 'index.js')).href)
  const returned = getOrCreateSidecarToken(healRoot)
  assert('token: 自愈不轮换（返回值 === 预写值）', returned === T, returned)
  assert('token: 自愈纠正文件到 0600', mode(join(healRoot, '.oneshot', 'sidecar-token')) === 0o600, `mode=${mode(join(healRoot, '.oneshot', 'sidecar-token')).toString(8)}`)
  assert('token: 自愈纠正目录到 0700', mode(join(healRoot, '.oneshot')) === 0o700, `mode=${mode(join(healRoot, '.oneshot')).toString(8)}`)
  rmSync(healRoot, { recursive: true, force: true })
}

// ---------- AC-3 doctor 不读 stdin：打开且永不写入/关闭的管道，15 秒竞速 ----------
{
  const bareCwd = join(TMP, 'security-bare-cwd')
  rmSync(bareCwd, { recursive: true, force: true })
  mkdirSync(bareCwd, { recursive: true })
  const noCredsEnv = { ...process.env }
  delete noCredsEnv.ONESHOT_SUPERUSER_EMAIL
  delete noCredsEnv.ONESHOT_SUPERUSER_PASSWORD
  const child = spawn(process.execPath, [CLI, 'doctor', '--json', '--url', PB, '--config', join(FIXTURE, 'oneshot.config.ts')], {
    cwd: bareCwd, env: noCredsEnv, stdio: ['pipe', 'pipe', 'pipe'],
  })
  // 父进程永不写、永不 end stdin —— 任何"读 stdin 等输入"的实现都会在这里永久挂起
  let stdout = ''
  child.stdout.on('data', (c) => { stdout += c })
  const outcome = await Promise.race([
    new Promise((resolve) => child.once('exit', (code) => resolve({ code }))),
    new Promise((resolve) => setTimeout(() => { child.kill('SIGKILL'); resolve({ timedOut: true }) }, 15000)),
  ])
  assert('doctor: 打开的 stdin 管道下 15 秒内自然退出且退出码 0', !outcome.timedOut && outcome.code === 0,
    JSON.stringify(outcome))
  let parsed = null
  try { parsed = JSON.parse(stdout) } catch { /* stdout 非单个 JSON */ }
  const cred = parsed?.checks?.find((c) => c.id === 'credentials')
  assert('doctor: 无凭据时 credentials warn（文案明确绝不交互等待 stdin）',
    cred?.status === 'warn' && cred.detail.includes('stdin'), JSON.stringify(cred))
  rmSync(bareCwd, { recursive: true, force: true })
}

// ---------- AC-4 doctor secret 卫生：stdout+stderr 全文无密码、无 token 值 ----------
{
  const res = spawnSync(process.execPath, [CLI, 'doctor', '--json', '--hooks-dir', HOOKS, '--engine', PB_BIN], {
    cwd: FIXTURE, env: ENV, encoding: 'utf8', timeout: 60000,
  })
  const full = (res.stdout ?? '') + (res.stderr ?? '')
  assert('doctor: 输出不含超管密码', !full.includes('oneshot123'), '输出泄漏密码')
  assert('doctor: 输出不含 sidecar token 值', !full.includes(tokenValue), '输出泄漏 token')
}

// ---------- AC-4b 普通模式（无 --json）与失败路径的 secret 卫生 ----------
{
  // 普通模式 + 真实凭据
  const ok = spawnSync(process.execPath, [CLI, 'doctor', '--hooks-dir', HOOKS, '--engine', PB_BIN], {
    cwd: FIXTURE, env: ENV, encoding: 'utf8', timeout: 60000,
  })
  const okFull = (ok.stdout ?? '') + (ok.stderr ?? '')
  assert('doctor(普通模式): 输出不含超管密码', !okFull.includes('oneshot123'), '输出泄漏密码')
  assert('doctor(普通模式): 输出不含 sidecar token 值', !okFull.includes(tokenValue), '输出泄漏 token')
}
{
  // 失败路径 + 错误密码（经 env 与经 flag 两条注入路径都不回显）
  const wrong = 'WRONGPASS-secret-x'
  const bad = spawnSync(process.execPath, [CLI, 'doctor', '--json', '--email', 'admin@example.com', '--password', wrong, '--hooks-dir', HOOKS, '--engine', PB_BIN], {
    cwd: FIXTURE, env: { ...process.env, ONESHOT_PB_URL: PB }, encoding: 'utf8', timeout: 60000,
  })
  const badFull = (bad.stdout ?? '') + (bad.stderr ?? '')
  assert('doctor(失败路径): 输出不含错误密码', !badFull.includes(wrong), '输出泄漏错误密码')
  assert('doctor(失败路径): credentials fail 且退出码 1', bad.status === 1, `status=${bad.status}`)
}

// ---------- AC-5 sidecar 401 不回显合法 token ----------
{
  const wrong = await fetch(CTRL + '/sidecar/tasks/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer wrong-token-${Math.random().toString(16).slice(2)}` },
    body: '{}',
  })
  const bodyText = await wrong.text()
  assert('sidecar: 错误 Bearer 返回 401 且响应体不回显合法 token', wrong.status === 401 && !bodyText.includes(tokenValue),
    `status=${wrong.status} body=${bodyText.slice(0, 80)}`)
}

// ---------- AC-6 越界 handler 现状钉住（文档化决策：超管可信，允许项目外引用；未来收紧/放宽即红灯） ----------
{
  const outProj = join(TMP, 'security-out-proj')
  const outHandler = join(TMP, 'outside-handler')
  rmSync(outProj, { recursive: true, force: true })
  rmSync(outHandler, { recursive: true, force: true })
  cpSync(FIXTURE, outProj, { recursive: true })
  mkdirSync(outHandler, { recursive: true })
  writeFileSync(join(outHandler, 'handler.ts'), "export function stats() {\n  return { pinned: 'outside-handler' }\n}\n", 'utf8')
  const cfg = readFileSync(join(FIXTURE, 'oneshot.config.ts'), 'utf8')
  writeFileSync(join(outProj, 'oneshot.config.ts'),
    cfg.replace("'./hooks/tasks.ts#stats'", "'../outside-handler/handler.ts#stats'"), 'utf8')
  const res = spawnSync(process.execPath, [CLI, 'doctor', '--json', '--config', join(outProj, 'oneshot.config.ts')], {
    cwd: outProj, env: ENV, encoding: 'utf8', timeout: 60000,
  })
  let parsed = null
  try { parsed = JSON.parse(res.stdout) } catch { /* 非 JSON */ }
  const configCheck = parsed?.checks?.find((c) => c.id === 'config')
  assert('handler: 项目外引用被接受（文档化决策，见 README 已知约束）', configCheck?.status === 'ok', res.stdout || res.stderr)
  rmSync(outProj, { recursive: true, force: true })
  rmSync(outHandler, { recursive: true, force: true })
}

summary('security')
