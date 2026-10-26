#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(ROOT, '../..')
const CLI = join(REPO, 'packages/cli/dist/index.js')
const PB = 'http://127.0.0.1:8195'
const CTRL = 'http://127.0.0.1:7866'
const WEB = 'http://127.0.0.1:5175'
const EMAIL = 'admin@library-e2e.dev'
const PASSWORD = 'library-e2e-123'
const KEEP = process.argv.includes('--keep')
const API_ONLY = process.argv.includes('--api-only')
const WORK = join(ROOT, '.oneshot/e2e')
const children = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message) => process.stdout.write(`${message}\n`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败（${result.status}）`)
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'ignore', ...options })
  children.push(child)
  return child
}

async function wait(url, path = '/api/health') {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url + path, { signal: AbortSignal.timeout(800) })
      if (res.status < 500) return
    } catch {}
    await sleep(150)
  }
  throw new Error(`服务启动超时：${url}`)
}

async function request(method, path, body, token) {
  const res = await fetch(PB + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(data)}`)
  return data
}

async function main() {
  if (!existsSync(CLI)) throw new Error('请先在仓库根目录执行 pnpm build')
  if (!existsSync(join(ROOT, 'node_modules/@oneshot/core'))) {
    mkdirSync(join(ROOT, 'node_modules/@oneshot'), { recursive: true })
    symlinkSync(join(REPO, 'packages/core'), join(ROOT, 'node_modules/@oneshot/core'), 'junction')
  }
  const bin = join(ROOT, `.oneshot/pocketbase${process.platform === 'win32' ? '.exe' : ''}`)
  if (!existsSync(bin)) run(process.execPath, [CLI, 'engine', 'install'], { cwd: ROOT, stdio: 'inherit' })

  rmSync(WORK, { recursive: true, force: true })
  const dataDir = join(WORK, 'data')
  const hooksDir = join(WORK, 'hooks')
  const migrationsDir = join(WORK, 'migrations')
  for (const dir of [dataDir, hooksDir, migrationsDir]) mkdirSync(dir, { recursive: true })
  run(bin, ['superuser', 'upsert', EMAIL, PASSWORD, '--dir', dataDir])
  const engineArgs = ['serve', '--http', '127.0.0.1:8195', '--dir', dataDir, '--hooksDir', hooksDir, '--migrationsDir', migrationsDir]
  let pb = start(bin, engineArgs)
  await wait(PB)
  log(`PocketBase: ${PB}`)

  const auth = await request('POST', '/api/collections/_superusers/auth-with-password', { identity: EMAIL, password: PASSWORD })
  await request('PATCH', '/api/settings', { batch: { enabled: true, maxRequests: 60, timeout: 10, maxBodySize: 0 } }, auth.token)
  const env = {
    ...process.env,
    ONESHOT_PB_URL: PB,
    ONESHOT_SIDECAR_URL: CTRL,
    ONESHOT_SUPERUSER_EMAIL: EMAIL,
    ONESHOT_SUPERUSER_PASSWORD: PASSWORD,
  }
  run(process.execPath, [CLI, 'publish', '--config', join(ROOT, 'oneshot.config.ts'), '--hooks-dir', hooksDir], { cwd: ROOT, env })

  pb.kill('SIGKILL')
  for (;;) {
    try { await fetch(PB + '/api/health', { signal: AbortSignal.timeout(300) }) } catch { break }
    await sleep(100)
  }
  pb = start(bin, engineArgs)
  await wait(PB)
  start(process.execPath, [CLI, 'console', '--port', '7866', '--config', join(ROOT, 'oneshot.config.ts')], { cwd: ROOT, env })
  await wait(CTRL, '/api/manifest')
  log(`Sidecar: ${CTRL}`)

  const suiteEnv = { ...env, LIBRARY_PB_URL: PB, LIBRARY_CTRL_URL: CTRL, LIBRARY_WEB_URL: WEB, LIBRARY_SU_EMAIL: EMAIL, LIBRARY_SU_PASSWORD: PASSWORD }
  run(process.execPath, [join(ROOT, 'tests/e2e.mjs')], { cwd: ROOT, env: suiteEnv, stdio: 'inherit' })

  if (!API_ONLY) {
    const vite = join(ROOT, 'web/node_modules/vite/bin/vite.js')
    if (!existsSync(vite)) throw new Error('请先在 examples/library/web 执行 npm install')
    start(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd: join(ROOT, 'web'), env: { ...suiteEnv, VITE_PB_URL: PB } })
    await wait(WEB, '/')
    log(`Web: ${WEB}`)
    run(process.execPath, [join(ROOT, 'tests/browser-e2e.mjs')], { cwd: ROOT, env: suiteEnv, stdio: 'inherit' })
  }
  log('\n图书管理 API 与浏览器 E2E 全部通过')
}

main().catch((error) => {
  console.error(`\nE2E 失败：${error?.message ?? error}`)
  process.exitCode = 1
}).finally(async () => {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill('SIGKILL')
  }
  await sleep(250)
  if (!KEEP) rmSync(WORK, { recursive: true, force: true })
  else log(`测试现场：${WORK}`)
})
