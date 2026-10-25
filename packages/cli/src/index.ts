#!/usr/bin/env node
import { mkdir, writeFile, watch } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { loadManifest } from '@oneshot/core'
import { publish } from '@oneshot/core'
import { generateClients } from '@oneshot/core'
import { serializeConfig } from '@oneshot/core'
import { buildSidecarRegistry, handleSidecarRequest, getOrCreateSidecarToken, hasSidecarActions } from '@oneshot/core'
import type { ResolvedManifest, SidecarRegistry } from '@oneshot/core'
import {
  consoleDist,
  engineDown,
  engineInstall,
  enginePaths,
  engineSuperuser,
  engineUp,
  DEFAULT_PB_VERSION,
} from './engine.js'
import { serveControlServer } from './console-server.js'
import { runDoctor } from './doctor.js'
import { createManifestApi } from './control-api.js'
import { ENV_EXAMPLE, INIT_GITIGNORE, renderTemplateReadme } from './templates.js'
import { TEMPLATES, templateNames } from './templates-ts/registry.js'

// ---------- 小工具 ----------

function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string | boolean> } {
  const _: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      _.push(a)
    }
  }
  return { _, flags }
}

function loadDotEnv(cwd: string): void {
  const envPath = resolve(cwd, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    const val = m[2].replace(/^['"]|['"]$/g, '')
    if (process.env[key] === undefined) process.env[key] = val
  }
}

async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

async function resolveSuperuser(): Promise<{ email: string; password: string }> {
  let email = process.env.ONESHOT_SUPERUSER_EMAIL ?? ''
  let password = process.env.ONESHOT_SUPERUSER_PASSWORD ?? ''
  if (!email) email = await promptHidden('PocketBase 超管邮箱: ')
  if (!password) password = await promptHidden('PocketBase 超管密码: ')
  if (!email || !password) throw new Error('需要超管账号（ONESHOT_SUPERUSER_EMAIL / ONESHOT_SUPERUSER_PASSWORD 或交互输入）')
  return { email, password }
}

function findConfig(flags: Record<string, string | boolean>): string {
  const explicit = flags.config as string | undefined
  if (explicit) return resolve(explicit)
  for (const name of ['oneshot.config.ts', 'oneshot.config.mts', 'oneshot.config.mjs', 'oneshot.config.js']) {
    const p = resolve(process.cwd(), name)
    if (existsSync(p)) return p
  }
  throw new Error('当前目录没有 oneshot.config.ts（--config 可指定路径，或先 oneshot init）')
}

async function doPublish(flags: Record<string, string | boolean>): Promise<void> {
  loadDotEnv(process.cwd())
  const manifest = await loadManifest(findConfig(flags))
  const { email, password } = await resolveSuperuser()
  const env = flags.env ? String(flags.env) : undefined
  const target = env
    ? (process.env.ONESHOT_PB_URL || manifest.config.environments?.[env]?.baseUrl || '(未知)')
    : (process.env.ONESHOT_PB_URL || manifest.config.baseUrl)
  process.stderr.write(`🚀 发布 ${manifest.config.name}${env ? ` [${env}]` : ''} → ${target}\n`)
  const report = await publish({
    manifest,
    superuserEmail: email,
    superuserPassword: password,
    env,
    prune: flags.prune === true,
    gen: flags['no-gen'] !== true,
    hooksDir: flags['hooks-dir'] ? resolve(String(flags['hooks-dir'])) : undefined,
    log: (msg) => process.stderr.write(`  ${msg}\n`),
  })
  process.stderr.write(`✅ 发布完成：新增 ${report.created.length} · 更新 ${report.updated.length} · 不变 ${report.unchanged.length} · hooks ${report.hooksFiles.length}`)
  if (report.pruned.length) process.stderr.write(` · 删除 ${report.pruned.length}`)
  process.stderr.write(`\n`)
}

async function doDev(flags: Record<string, string | boolean>): Promise<void> {
  loadDotEnv(process.cwd())
  const configPath = findConfig(flags)
  const paths = enginePaths(process.cwd())
  // --pb-port 只管 PocketBase 引擎；控制服务器端口由 --port 管（两者默认 8090 / 7860 互不相干）
  const url = await engineUp({ port: flags['pb-port'] ? Number(flags['pb-port']) : undefined })
  process.stderr.write(`🟢 PocketBase: ${url}  (admin: ${url}/_/  log: ${paths.logFile})\n`)

  let ctrl: Awaited<ReturnType<typeof startControl>> | null = null
  const run = async () => {
    try {
      await doPublish(flags)
      // sidecar handler 改动后随发布自动热重载（manifest 变更由 onManifestUpdated 覆盖）
      await ctrl?.rebuildSidecar()
    } catch (err: any) {
      process.stderr.write(`❌ ${err?.message ?? err}\n`)
    }
  }
  await run()

  // 控制台 + sidecar 一起起
  try {
    ctrl = await startControl(flags)
    process.stderr.write(`🖥️  控制台/sidecar: ${ctrl.url}\n`)
    for (const r of ctrl.sidecarRoutes) process.stderr.write(`⚙️  sidecar: ${r}\n`)
  } catch (err: any) {
    process.stderr.write(`⚠️ 控制服务器未启动：${err?.message ?? err}\n`)
  }

  if (flags.watch === true) {
    process.stderr.write('👀 watch 模式：修改 oneshot.config.ts / hooks/ 后自动重新发布（Ctrl+C 退出）\n')
    const root = dirname(configPath)
    const watchers = [watch(configPath, { persistent: true })]
    const hooksPath = join(root, 'hooks')
    if (existsSync(hooksPath)) watchers.push(watch(hooksPath, { persistent: true }))
    let timer: NodeJS.Timeout | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        process.stderr.write('——— 变更检测，重新发布 ———\n')
        void run()
      }, 400)
    }
    await Promise.all(watchers.map(async (w) => {
      for await (const _event of w) {
        void _event
        schedule()
      }
    }))
  }
}

async function doInit(targetDir: string, flags: Record<string, string | boolean>): Promise<void> {
  const templateName = (flags.template as string) ?? 'todo'
  const template = TEMPLATES[templateName]
  if (!template) throw new Error(`未知模板：${templateName}（可用：${templateNames().join(', ')}）`)

  const dir = resolve(process.cwd(), targetDir ?? '.')
  const files: Record<string, string> = {
    'oneshot.config.ts': serializeConfig(template.config()),
    'package.json': JSON.stringify({
      name: basename(dir) || template.name,
      private: true,
      type: 'module',
      dependencies: { '@oneshot/core': '^0.1.0' },
    }, null, 2) + '\n',
    ...template.hooks,
    '.env.example': ENV_EXAMPLE,
    'README.md': renderTemplateReadme(template),
    '.gitignore': INIT_GITIGNORE,
    'web/src/api/.gitkeep': '',
    'mobile/lib/api/.gitkeep': '',
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  process.stderr.write(`✅ 已初始化 OneShot 项目（模板：${template.title}）：${dir}\n下一步：\n  cd ${basename(dir)}\n  pnpm add @oneshot/core\n  oneshot engine install && oneshot superuser admin@example.com 1234567890\n  oneshot dev\n`)
}

function findConfigOptional(flags: Record<string, string | boolean>): string | undefined {
  try {
    return findConfig(flags)
  } catch {
    return undefined
  }
}

/** 控制服务器 = 只读控制台 + manifest 写回 API + sidecar JSON API（同一端口） */
async function startControl(flags: Record<string, string | boolean>): Promise<{
  url: string
  sidecarRoutes: string[]
  /** 重新加载 manifest + 重建 sidecar registry（dev watch 循环里发布后调用） */
  rebuildSidecar: () => Promise<void>
}> {
  loadDotEnv(process.cwd())
  const host = (flags.host as string) ?? '127.0.0.1'
  const port = flags.port ? Number(flags.port) : 7860
  let dist: string
  try {
    dist = consoleDist()
  } catch {
    throw new Error('找不到 @oneshot/console（monorepo 内请先 pnpm build）')
  }
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`控制台未构建：${dist} 缺少 index.html（pnpm --filter @oneshot/console build）`)
  }

  let currentManifest: ResolvedManifest | null = null
  let registry: SidecarRegistry | null = null
  let sidecarToken = ''
  let pbUrl = 'http://127.0.0.1:8090'
  const configPath = findConfigOptional(flags)
  if (configPath) {
    currentManifest = await loadManifest(configPath)
    pbUrl = (process.env.ONESHOT_PB_URL || currentManifest.config.baseUrl || 'http://127.0.0.1:8090').replace(/\/$/, '')
    if (hasSidecarActions(currentManifest.config)) {
      sidecarToken = getOrCreateSidecarToken(currentManifest.root)
      registry = await buildSidecarRegistry(currentManifest, resolve(currentManifest.root, '.oneshot/sidecar'))
    }
  }

  const manifestApi = currentManifest
    ? createManifestApi({
        getManifest: () => currentManifest,
        pbUrl,
        log: (msg) => process.stderr.write(`  ${msg}\n`),
        onManifestUpdated: async (fresh) => {
          currentManifest = fresh
          if (hasSidecarActions(fresh.config)) {
            sidecarToken = getOrCreateSidecarToken(fresh.root)
            registry = await buildSidecarRegistry(fresh, resolve(fresh.root, '.oneshot/sidecar'))
          } else {
            registry = null
          }
        },
      })
    : null

  const api = manifestApi
    ? async (req: any, res: any): Promise<boolean> => {
        if (await manifestApi(req, res)) return true
        if (registry && (await handleSidecarRequest(registry, req, res, { token: sidecarToken, pbUrl })).handled) return true
        return false
      }
    : undefined

  const rebuildSidecar = async (): Promise<void> => {
    if (!configPath) return
    const fresh = await loadManifest(configPath)
    currentManifest = fresh
    if (hasSidecarActions(fresh.config)) {
      sidecarToken = getOrCreateSidecarToken(fresh.root)
      registry = await buildSidecarRegistry(fresh, resolve(fresh.root, '.oneshot/sidecar'))
    } else {
      registry = null
    }
  }

  const url = await serveControlServer({ distDir: dist, host, port, api })
  const sidecarRoutes = (registry?.entries ?? []).map((e) => `${e.method} ${e.route} → Node`)
  return { url, sidecarRoutes, rebuildSidecar }
}

async function doConsole(flags: Record<string, string | boolean>): Promise<void> {
  const { url, sidecarRoutes } = await startControl(flags)
  process.stderr.write(`🖥️  OneShot 控制台: ${url}\n   打开后填入 PocketBase 地址与超管账号即可浏览服务。\n`)
  for (const r of sidecarRoutes) process.stderr.write(`⚙️  sidecar: ${r}\n`)
}

const HELP = `oneshot — 基于 PocketBase 的自托管服务发布/生成框架

命令:
  oneshot init [dir] [--template todo|blog|shop|chat]
                                  初始化项目（内置服务模板）
  oneshot publish [--config p] [--env name] [--prune] [--no-gen] [--hooks-dir p]
                                  发布 manifest 到 PocketBase（diff 式；--env 走 environments 块）
  oneshot gen [--config p]        只运行客户端代码生成（TS + Dart）
  oneshot dev [--watch] [--pb-port] [--port]
                                  启动引擎 + 发布 + 生成（--watch 增量；--pb-port 引擎端口 / --port 控制台端口）
  oneshot engine install [--version v]
                                  下载 PocketBase 二进制
  oneshot engine up [--port]      后台启动 PocketBase
  oneshot engine down             停止 PocketBase
  oneshot superuser <email> <password>
                                  创建/重置超管账号
  oneshot console [--host] [--port]
                                  启动只读控制台
  oneshot doctor [--config p] [--url u] [--email e] [--password p] [--hooks-dir p] [--engine p] [--json]
                                  一键体检：manifest/引擎/连通性/凭据/快照漂移/孤儿 hooks/磁盘（--json 供 CI，绝不读 stdin）

环境变量: ONESHOT_PB_URL, ONESHOT_SUPERUSER_EMAIL, ONESHOT_SUPERUSER_PASSWORD（或项目根 .env）
`

async function main(): Promise<void> {
  const { _, flags } = parseArgs(process.argv.slice(2))
  const cmd = _[0]
  try {
    switch (cmd) {
      case 'init':
        return await doInit(_[1] ?? '.', flags)
      case 'publish':
        return await doPublish(flags)
      case 'gen': {
        loadDotEnv(process.cwd())
        const manifest = await loadManifest(findConfig(flags))
        const dirs = await generateClients(manifest.config, manifest.root)
        for (const d of dirs) process.stderr.write(`📦 ${d}\n`)
        return
      }
      case 'dev':
        return await doDev(flags)
      case 'engine': {
        const sub = _[1]
        if (sub === 'install') {
          await engineInstall((flags.version as string) ?? DEFAULT_PB_VERSION)
          return
        }
        if (sub === 'up') {
          const url = await engineUp({ port: flags.port ? Number(flags.port) : undefined })
          process.stderr.write(`🟢 PocketBase: ${url}（${enginePaths().logFile}）\n`)
          return
        }
        if (sub === 'down') {
          const ok = await engineDown()
          process.stderr.write(ok ? '🛑 已停止\n' : '没有正在运行的引擎\n')
          return
        }
        throw new Error('engine 子命令：install | up | down')
      }
      case 'superuser': {
        if (!_[1] || !_[2]) throw new Error('用法：oneshot superuser <email> <password>')
        engineSuperuser(_[1], _[2])
        process.stderr.write('✅ 超管账号已就绪\n')
        return
      }
      case 'console':
        return await doConsole(flags)
      case 'doctor': {
        // 体检：复用 publish 同款 .env → 环境变量解析，但凭据缺失只 warn，绝不读 stdin
        loadDotEnv(process.cwd())
        let configPath: string | undefined
        let configLookupError: string | undefined
        try {
          configPath = findConfig(flags)
        } catch (err: any) {
          configLookupError = err?.message ?? String(err)
        }
        const report = await runDoctor({
          cwd: process.cwd(),
          configPath,
          configLookupError,
          url: flags.url ? String(flags.url) : undefined,
          email: flags.email ? String(flags.email) : undefined,
          password: flags.password ? String(flags.password) : undefined,
          hooksDir: flags['hooks-dir'] ? resolve(String(flags['hooks-dir'])) : undefined,
          engineBin: flags.engine ? String(flags.engine) : undefined,
        })
        // 人类可读摘要始终走 stderr（--json 时 stdout 只放单个 JSON 文档）
        const icon = { ok: '✅', warn: '⚠️', fail: '❌', skip: '⏭' } as const
        for (const c of report.checks) process.stderr.write(`${icon[c.status]} [${c.id}] ${c.detail}\n`)
        const count = (s: string) => report.checks.filter((c) => c.status === s).length
        const skipPart = count('skip') > 0 ? ` · ${count('skip')} 项 skip` : ''
        process.stderr.write(`诊断完成：${count('ok')} 项 ok · ${count('warn')} 项 warn · ${count('fail')} 项 fail${skipPart}\n`)
        if (flags.json) {
          process.stdout.write(JSON.stringify({ project: report.project, target: report.target, ok: report.ok, checks: report.checks }, null, 2) + '\n')
        }
        process.exitCode = report.ok ? 0 : 1
        return
      }
      case 'help':
      case undefined:
        process.stdout.write(HELP)
        return
      default:
        throw new Error(`未知命令：${cmd}\n${HELP}`)
    }
  } catch (err: any) {
    process.stderr.write(`❌ ${err?.message ?? err}\n`)
    process.exitCode = 1
  }
}

void main()
