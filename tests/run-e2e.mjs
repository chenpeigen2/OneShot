#!/usr/bin/env node
/**
 * OneShot e2e 测试编排器：
 * - 拉起两个隔离 PB 实例（8099 主 / 8097 staging）+ 一个控制服务器（7861）
 * - 发布夹具项目与 manifest 副本项目
 * - 顺序执行 tests/suites/*.test.mjs（环境变量注入目标），汇总退出码
 * - 结束后清理全部子进程与临时目录（--keep 保留现场调试）
 *
 * 用法：node tests/run-e2e.mjs [--keep] [--suite core]
 */
import { spawn, execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'packages/cli/dist/index.js')
const TMP = join(ROOT, 'tests/.tmp')
const KEEP = process.argv.includes('--keep')
const ONLY = process.argv.includes('--suite') ? process.argv[process.argv.indexOf('--suite') + 1] : null

const MAIN_PORT = 8099
const STAGING_PORT = 8097
const CTRL_PORT = 7861

const log = (msg) => process.stdout.write(msg + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1200) })
      if (res.ok) return true
    } catch {}
    await sleep(250)
  }
  return false
}

/** 等待实例彻底下线（端口可复用）——冷重启前必须等旧进程退出，否则新进程绑定失败 */
async function waitPortDown(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url + '/api/health', { signal: AbortSignal.timeout(600) })
      await sleep(150)
    } catch {
      return true
    }
  }
  return false
}

/** 等待 HTTP 服务器开始应答（任何状态码都算就绪，含 401） */
async function waitHttpUp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url + '/api/manifest', { signal: AbortSignal.timeout(800) })
      return true
    } catch {}
    await sleep(200)
  }
  return false
}

async function main() {
  if (!existsSync(CLI)) {
    log('🏗️  先构建 workspace（pnpm -r build）…')
    execFileSync('pnpm', ['-r', 'build'], { cwd: ROOT, stdio: 'inherit' })
  }

  // 引擎二进制：优先复用 examples 的，否则装到 tests/.tmp
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  let pbBin = join(ROOT, 'examples/todo/.oneshot/pocketbase')
  if (process.platform === 'win32') pbBin += '.exe'
  if (!existsSync(pbBin)) {
    log('⬇️  下载 PocketBase 引擎…')
    execFileSync(process.execPath, [CLI, 'engine', 'install'], { cwd: TMP, stdio: 'inherit' })
    pbBin = join(TMP, '.oneshot/pocketbase')
  }

  // 起两个隔离实例
  const startInstance = async (name, port) => {
    const dataDir = join(TMP, `pb_${name}`)
    const hooksDir = join(TMP, `hooks_${name}`)
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(hooksDir, { recursive: true })
    spawnSync(pbBin, ['superuser', 'upsert', 'admin@example.com', 'oneshot123', '--dir', dataDir], { stdio: 'ignore' })
    // --migrationsDir 按实例隔离：PB 默认迁移目录是 <dataDir>/../pb_migrations，两个实例会成为兄弟目录共享一份，
    // staging 发布的 automigrate 文件会泄入主实例，下一次 hooks 热重载重放迁移时因 collection 已存在而致命退出。
    const migrationsDir = join(TMP, `pb_migrations_${name}`)
    mkdirSync(migrationsDir, { recursive: true })
    const child = spawn(pbBin, ['serve', '--http', `127.0.0.1:${port}`, '--dir', dataDir, '--hooksDir', hooksDir, '--migrationsDir', migrationsDir],
      { stdio: ['ignore', 'ignore', 'ignore'] })
    const url = `http://127.0.0.1:${port}`
    if (!(await waitHealth(url))) throw new Error(`实例 ${name} 启动超时`)
    log(`🟢 ${name}: ${url}`)
    return { child, url, dataDir, hooksDir, migrationsDir }
  }

  const mainInst = await startInstance('main', MAIN_PORT)
  const stagingInst = await startInstance('staging', STAGING_PORT)

  // 脚手架：夹具项目 + manifest 副本项目
  const scaffold = (name) => {
    const dir = join(TMP, name)
    cpSync(join(ROOT, 'tests/fixtures'), dir, { recursive: true })
    mkdirSync(join(dir, 'node_modules/@oneshot'), { recursive: true })
    symlinkSync(join(ROOT, 'packages/core'), join(dir, 'node_modules/@oneshot/core'))
    return dir
  }
  const fixtureDir = scaffold('project')
  const manifestDir = scaffold('manifest-project')

  // 统一 sidecar token（两个项目共用，控制服务器与 publish 烘焙一致）
  // 源头保持权限不变式：目录 0700 / token 0600（与 core 创建路径语义一致，security 套件有断言）
  const token = Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  for (const dir of [fixtureDir, manifestDir]) {
    mkdirSync(join(dir, '.oneshot'), { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, '.oneshot/sidecar-token'), token, { mode: 0o600 })
  }

  const mainHooksDir = mainInst.hooksDir
  const publish = (dir) => {
    const res = spawnSync(process.execPath, [CLI, 'publish', '--config', join(dir, 'oneshot.config.ts'), '--hooks-dir', mainHooksDir],
      { stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ONESHOT_PB_URL: `http://127.0.0.1:${MAIN_PORT}`,
        ONESHOT_SUPERUSER_EMAIL: 'admin@example.com', ONESHOT_SUPERUSER_PASSWORD: 'oneshot123',
        ONESHOT_SIDECAR_URL: `http://127.0.0.1:${CTRL_PORT}` } })
    process.stdout.write(res.stdout ?? '')
    if (res.stderr) process.stderr.write(res.stderr)
    if (res.status !== 0) throw new Error(`publish 失败（${dir}）`)
  }
  log('🚀 发布夹具与 manifest 副本项目…')
  publish(fixtureDir)
  publish(manifestDir)

  // 模板预处理：init + publish（与夹具共用同一 hooks 目录），业务断言在套件里做
  log('📦 预发布模板（blog/shop/chat）…')
  for (const tpl of ['blog', 'shop', 'chat']) {
    const dir = join(TMP, `tpl-${tpl}`)
    cpSync(join(ROOT, `tests/fixtures`), dir, { recursive: true }) // 占位（init 会覆盖 config/hooks）
    rmSync(join(dir, 'hooks'), { recursive: true, force: true })
    execFileSync(process.execPath, [CLI, 'init', dir, '--template', tpl], { stdio: 'pipe', env: process.env })
    mkdirSync(join(dir, 'node_modules/@oneshot'), { recursive: true })
    symlinkSync(join(ROOT, 'packages/core'), join(dir, 'node_modules/@oneshot/core'))
    const res = spawnSync(process.execPath, [CLI, 'publish', '--config', join(dir, 'oneshot.config.ts'), '--no-gen', '--hooks-dir', mainHooksDir],
      { stdio: 'pipe', encoding: 'utf8', env: { ...process.env, ONESHOT_PB_URL: `http://127.0.0.1:${MAIN_PORT}`,
        ONESHOT_SUPERUSER_EMAIL: 'admin@example.com', ONESHOT_SUPERUSER_PASSWORD: 'oneshot123',
        ONESHOT_SIDECAR_URL: `http://127.0.0.1:${CTRL_PORT}` } })
    process.stdout.write(res.stdout ?? '')
    if (res.stderr) process.stderr.write(res.stderr)
    if (res.status !== 0) throw new Error(`模板发布失败（${tpl}）`)
  }

  // 钩子已写入 → 冷重启主实例（规避热重载竞态）；先等旧进程真正退出再拉起
  mainInst.child.kill('SIGKILL')
  if (!(await waitPortDown(mainInst.url))) throw new Error('主实例未能退出')
  const child = spawn(pbBin, ['serve', '--http', `127.0.0.1:${MAIN_PORT}`, '--dir', mainInst.dataDir, '--hooksDir', mainInst.hooksDir, '--migrationsDir', mainInst.migrationsDir],
    { stdio: ['ignore', 'ignore', 'ignore'] })
  mainInst.child = child
  if (!(await waitHealth(mainInst.url))) throw new Error('主实例冷重启超时')
  log('🟢 main: 冷重启完成（hooks 就绪）')

  // 控制服务器（manifest 副本项目 + sidecar 承载）
  const ctrl = spawn(process.execPath, [CLI, 'console', '--port', String(CTRL_PORT), '--config', join(manifestDir, 'oneshot.config.ts')],
    { stdio: 'ignore', env: { ...process.env, ONESHOT_PB_URL: `http://127.0.0.1:${MAIN_PORT}`, ONESHOT_SIDECAR_URL: `http://127.0.0.1:${CTRL_PORT}` } })
  // 控制服务器就绪即继续（/api/manifest 有响应即可，未登录 401 也算），不再盲等固定时长
  if (!(await waitHttpUp(`http://127.0.0.1:${CTRL_PORT}`))) throw new Error('控制服务器启动超时')
  log(`🟢 control: http://127.0.0.1:${CTRL_PORT}`)

  const suiteEnv = {
    ...process.env,
    TEST_PB: mainInst.url,
    TEST_STAGING: stagingInst.url,
    TEST_CTRL: `http://127.0.0.1:${CTRL_PORT}`,
    TEST_CLI: CLI,
    TEST_TMP: join(ROOT, 'tests/.tmp'),
    TEST_FIXTURE_DIR: fixtureDir,
    TEST_CORE_DIR: join(ROOT, 'packages/core'),
    TEST_MAIN_HOOKS_DIR: mainHooksDir,
    TEST_PB_BIN: pbBin,
  }

  const suites = ['core', 'sidecar-realtime', 'manifest', 'env-collections', 'templates', 'doctor', 'security', 'console-ui']
    .filter((s) => !ONLY || s === ONLY)
  let failed = 0
  for (const suite of suites) {
    log(`\n━━━ 套件 ${suite} ━━━`)
    const res = spawnSync(process.execPath, [join(ROOT, `tests/suites/${suite}.test.mjs`)], {
      env: suiteEnv, encoding: 'utf8', timeout: 180000,
    })
    process.stdout.write(res.stdout ?? '')
    if (res.stderr) process.stderr.write(res.stderr)
    if (res.status !== 0) failed++
  }

  log(`\n━━━ 总结：${suites.length - failed}/${suites.length} 套件通过 ━━━`)

  // 清理
  ctrl.kill('SIGKILL')
  mainInst.child.kill('SIGKILL')
  stagingInst.child.kill('SIGKILL')
  await sleep(400)
  if (!KEEP) rmSync(TMP, { recursive: true, force: true })
  else log(`🧪 现场保留：${TMP}`)

  process.exitCode = failed > 0 ? 1 : 0
}

main().catch(async (err) => {
  log(`❌ 编排失败：${err?.message ?? err}`)
  // 兜底清理
  spawnSync('pkill', ['-f', 'tests/.tmp/pb_'])
  try { spawnSync('pkill', ['-f', 'index.js console']) } catch {}
  process.exitCode = 1
})
