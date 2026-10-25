// oneshot doctor — 一键体检：manifest → 引擎 → 连通性 → 凭据 → 快照漂移 → 孤儿 hooks → 磁盘
// 约束（R1）：绝不读 stdin（CI / spawnSync 管道安全，凭据缺失走 warn）；warn/skip 不影响退出码；任一 fail → 退出码 1。
// 纯诊断不代修：孤儿文件 / 漂移 / 磁盘只给可行动提示（--fix 属非目标）。
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { resolve } from 'node:path'
import { buildSnapshot, loadManifest, snapshotHash, validateConfig } from '@oneshot/core'
import type { ResolvedManifest } from '@oneshot/core'
import { DEFAULT_PB_VERSION, enginePaths } from './engine.js'

export type CheckId = 'config' | 'engine' | 'connectivity' | 'credentials' | 'snapshot' | 'hooks' | 'disk'
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface CheckResult {
  id: CheckId
  status: CheckStatus
  detail: string
  /** hooks 项附加字段：孤儿产物文件名列表 */
  orphans?: string[]
  /** engine 项附加字段：版本号（如 v0.40.6） */
  version?: string
  /** snapshot 项附加字段：本地 manifest 的快照 hash */
  hash?: string
  /** disk 项附加字段：合计字节数 */
  bytes?: number
}

export interface DoctorReport {
  /** 无任何 fail（供退出码与 --json 的 ok 字段） */
  ok: boolean
  /** manifest 项目名（config 未通过时为 null） */
  project: string | null
  /** 解析后的目标实例地址（无法确定时为 null） */
  target: string | null
  /** 检查结果，固定顺序 config → engine → connectivity → credentials → snapshot → hooks → disk */
  checks: CheckResult[]
}

export interface DoctorOptions {
  /** 工作目录（引擎路径与 disk 检查的基准） */
  cwd: string
  /** manifest 路径（--config 或 findConfig 的结果；undefined = 查找失败，config 项 fail） */
  configPath?: string
  /** configPath 缺失时的查找失败提示（用作 config 项 detail） */
  configLookupError?: string
  /** 目标地址（--url）；解析顺序 --url > ONESHOT_PB_URL > manifest.baseUrl */
  url?: string
  /** 超管邮箱（--email）；缺省回落 ONESHOT_SUPERUSER_EMAIL */
  email?: string
  /** 超管密码（--password）；缺省回落 ONESHOT_SUPERUSER_PASSWORD */
  password?: string
  /** hooks 目录（--hooks-dir）；默认 <manifest 根或 cwd>/pb_hooks（与 publish 默认值一致） */
  hooksDir?: string
  /** 引擎二进制（--engine）；默认 enginePaths(cwd).bin */
  engineBin?: string
}

const HEALTH_TIMEOUT_MS = 2000
const DISK_WARN_BYTES = 1024 ** 3

function humanBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

/** 递归统计目录字节数（缺失/不可读计 0；符号链接不计入，避免重复与越界） */
function dirBytes(p: string): number {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(p, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const child = resolve(p, e.name)
    if (e.isDirectory()) {
      total += dirBytes(child)
    } else {
      try {
        total += statSync(child).size
      } catch {
        // 单个文件不可读计 0
      }
    }
  }
  return total
}

/** PB `--version` 输出形如 "pocketbase version 0.40.6"，归一成 v0.40.6 */
function extractVersion(raw: string): string {
  const m = raw.match(/(\d+(?:\.\d+)+)/)
  if (m) return `v${m[1]}`
  return raw.trim().split(/\s+/).pop() ?? raw.trim()
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const { cwd } = options
  const checks: CheckResult[] = []
  const push = (c: CheckResult): CheckResult => {
    checks.push(c)
    return c
  }

  // ---------- FR-2 config：loadManifest + validateConfig（内含 hooks/handler 文件存在性检查） ----------
  let manifest: ResolvedManifest | null = null
  if (!options.configPath) {
    push({ id: 'config', status: 'fail', detail: options.configLookupError ?? '当前目录没有 oneshot.config.ts（--config 可指定路径，或先 oneshot init）' })
  } else {
    try {
      manifest = await loadManifest(options.configPath)
      validateConfig(manifest.config, manifest.root) // loadManifest 内部已校验；显式执行 FR-2 规定的两步
      push({ id: 'config', status: 'ok', detail: `manifest 合法：${manifest.config.name}（${manifest.config.services.length} 个服务）` })
    } catch (err: any) {
      manifest = null
      push({ id: 'config', status: 'fail', detail: String(err?.message ?? err) })
    }
  }

  // ---------- FR-1 解析目标地址 / 凭据 / hooks 目录 / 引擎二进制 ----------
  const target = (options.url ?? process.env.ONESHOT_PB_URL ?? manifest?.config.baseUrl ?? '').replace(/\/+$/, '')
  const email = options.email ?? process.env.ONESHOT_SUPERUSER_EMAIL ?? ''
  const password = options.password ?? process.env.ONESHOT_SUPERUSER_PASSWORD ?? ''
  const hooksDir = options.hooksDir ?? resolve(manifest?.root ?? cwd, 'pb_hooks')
  const engineBin = options.engineBin ?? enginePaths(cwd).bin

  // ---------- FR-3 engine（独立于 manifest 与网络；本地引擎缺失不影响连接远端实例） ----------
  if (!existsSync(engineBin)) {
    push({
      id: 'engine',
      status: 'warn',
      detail: `本地引擎缺失：${engineBin}（oneshot engine install 可安装，默认 v${DEFAULT_PB_VERSION}；不影响连接远端实例）`,
    })
  } else {
    const v = spawnSync(engineBin, ['--version'], { encoding: 'utf8', timeout: 5000 })
    if (v.error || v.status !== 0) {
      const reason = v.error?.message ?? `退出码 ${v.status}`
      push({ id: 'engine', status: 'fail', detail: `引擎二进制无法执行：${engineBin}（${reason}）` })
    } else {
      const version = extractVersion(v.stdout ?? '')
      push({ id: 'engine', status: 'ok', detail: `本地引擎就绪：${version}`, version })
    }
  }

  // ---------- FR-4 connectivity：GET {baseUrl}/api/health（2 秒超时） ----------
  let connStatus: CheckStatus
  if (!manifest) {
    connStatus = push({ id: 'connectivity', status: 'skip', detail: 'manifest 未通过检查，跳过连通性检查' }).status
  } else if (!target) {
    connStatus = push({ id: 'connectivity', status: 'fail', detail: '无法确定目标地址（--url / ONESHOT_PB_URL / manifest.baseUrl 均未提供）' }).status
  } else {
    try {
      const res = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
      connStatus = res.ok
        ? push({ id: 'connectivity', status: 'ok', detail: `实例可达：${target}/api/health` }).status
        : push({ id: 'connectivity', status: 'fail', detail: `健康检查返回 HTTP ${res.status}：${target}/api/health` }).status
    } catch (err: any) {
      const code = err?.cause?.code ?? err?.name ?? err?.message
      connStatus = push({ id: 'connectivity', status: 'fail', detail: `无法连接 ${target}：${code}（检查引擎是否启动、地址是否正确）` }).status
    }
  }

  // ---------- FR-5 credentials：_superusers/auth-with-password（token 仅内存使用，绝不落盘/打印） ----------
  let token = ''
  let credStatus: CheckStatus
  if (!manifest || connStatus !== 'ok') {
    credStatus = push({ id: 'credentials', status: 'skip', detail: 'manifest 或连通性未通过，跳过凭据检查' }).status
  } else if (!email || !password) {
    credStatus = push({
      id: 'credentials',
      status: 'warn',
      detail: '未提供超管凭据，跳过登录验证（查找过 --email/--password、ONESHOT_SUPERUSER_EMAIL、ONESHOT_SUPERUSER_PASSWORD 与项目根 .env；doctor 绝不交互等待 stdin）',
    }).status
  } else {
    try {
      const res = await fetch(`${target}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password }),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      const data: any = await res.json().catch(() => ({}))
      if (res.ok && data?.token) {
        token = String(data.token)
        credStatus = push({ id: 'credentials', status: 'ok', detail: `超管登录成功：${email}` }).status
      } else {
        const msg = data?.message ? `：${data.message}` : ''
        credStatus = push({ id: 'credentials', status: 'fail', detail: `超管登录失败（HTTP ${res.status}）${msg}（核对 ONESHOT_SUPERUSER_EMAIL/PASSWORD，或 oneshot superuser 重置）` }).status
      }
    } catch (err: any) {
      credStatus = push({ id: 'credentials', status: 'fail', detail: `超管登录请求失败：${err?.message ?? err}` }).status
    }
  }

  // ---------- FR-6 snapshot：本地快照 hash vs PB oneshot_meta（前置：connectivity + credentials 均 ok） ----------
  if (!manifest || connStatus !== 'ok' || credStatus !== 'ok') {
    push({ id: 'snapshot', status: 'skip', detail: '连通性或凭据未通过，跳过快照对比' })
  } else {
    const localHash = snapshotHash(buildSnapshot(manifest.config))
    try {
      const filter = encodeURIComponent(`project = "${manifest.config.name}"`)
      const res = await fetch(`${target}/api/collections/oneshot_meta/records?filter=${filter}&perPage=1`, {
        headers: { Authorization: token },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        push({ id: 'snapshot', status: 'fail', detail: `查询 oneshot_meta 失败（HTTP ${res.status}）` })
      } else {
        const record = data?.items?.[0]
        const remoteHash: string | undefined = record?.snapshot?.hash
        if (!record) {
          push({ id: 'snapshot', status: 'warn', detail: `尚未发布：oneshot_meta 中没有项目 "${manifest.config.name}" 的记录（运行 oneshot publish）` })
        } else if (remoteHash === localHash) {
          push({ id: 'snapshot', status: 'ok', detail: `本地 manifest 与已发布版本一致：${localHash}`, hash: localHash })
        } else {
          push({
            id: 'snapshot',
            status: 'warn',
            detail: `本地 manifest 与已发布版本存在漂移，建议 oneshot publish（本地 ${localHash.slice(0, 8)} · 线上 ${(remoteHash ?? '(无)').slice(0, 8)}）`,
            hash: localHash,
          })
        }
      }
    } catch (err: any) {
      push({ id: 'snapshot', status: 'fail', detail: `查询 oneshot_meta 失败：${err?.message ?? err}` })
    }
  }

  // ---------- FR-7 hooks：孤儿产物 ----------
  // 判定范围 = 本地 manifest 服务 ∪ 目标实例 oneshot_meta 全部快照中出现过的服务：
  // 正常单项目用法（hooksDir = <项目根>/pb_hooks）manifest 名单即可；共享 hooks 目录（e2e/多项目同机）时
  // 其他项目的合法产物不应被误报，只有"任何已发布快照都没有"的文件（真孤儿）才算数。
  const knownServices = new Set((manifest?.config.services ?? []).map((s) => s.name))
  if (token && target) {
    try {
      const res = await fetch(`${target}/api/collections/oneshot_meta/records?perPage=200`, {
        headers: { Authorization: token },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}))
        for (const item of data?.items ?? []) {
          for (const svc of item?.snapshot?.services ?? []) {
            if (svc?.name) knownServices.add(String(svc.name))
          }
        }
      }
    } catch {
      // 拿不到已发布名单时按 manifest 名单严格判定
    }
  }
  if (!existsSync(hooksDir)) {
    push({ id: 'hooks', status: 'ok', detail: `hooks 目录不存在（尚未发布过）：${hooksDir}` })
  } else {
    let files: string[] | null = null
    let readError = ''
    try {
      files = readdirSync(hooksDir).filter((f) => f.endsWith('.pb.js'))
    } catch (err: any) {
      readError = String(err?.message ?? err)
    }
    if (files === null) {
      push({ id: 'hooks', status: 'fail', detail: `hooks 目录不可读：${hooksDir}（${readError}）` })
    } else {
      // 服务名解析：去掉 .pb.js 后取第一个 . 之前的部分（覆盖 <svc>.pb.js / <svc>.user.pb.js / <svc>.<coll>.user.pb.js）
      const orphans = files.filter((f) => !knownServices.has(f.replace(/\.pb\.js$/, '').split('.')[0]))
      if (orphans.length > 0) {
        push({ id: 'hooks', status: 'warn', orphans, detail: `发现 ${orphans.length} 个孤儿 hooks 产物：${orphans.join('、')}（确认无用后可手工删除）` })
      } else if (files.length > 0) {
        push({ id: 'hooks', status: 'ok', detail: `hooks 无孤儿产物（${files.length} 个产物文件均属于已知服务）` })
      } else {
        push({ id: 'hooks', status: 'ok', detail: 'hooks 目录为空（尚无 .pb.js 产物）' })
      }
    }
  }

  // ---------- FR-8 disk：.oneshot/ + pb_data/ + hooks 目录递归字节汇总（纯信息，永不 fail） ----------
  const paths = enginePaths(cwd)
  const parts: { label: string; path: string; bytes: number }[] = [
    { label: '.oneshot', path: paths.root, bytes: dirBytes(paths.root) },
    { label: 'pb_data', path: paths.dataDir, bytes: dirBytes(paths.dataDir) },
    { label: 'hooks', path: hooksDir, bytes: dirBytes(hooksDir) },
  ]
  const total = parts.reduce((sum, p) => sum + p.bytes, 0)
  const breakdown = parts.map((p) => `${p.label} ${humanBytes(p.bytes)}`).join(' · ')
  push({
    id: 'disk',
    status: total > DISK_WARN_BYTES ? 'warn' : 'ok',
    bytes: total,
    detail: total > DISK_WARN_BYTES
      ? `磁盘占用 ${humanBytes(total)}（${breakdown}）——超过 1 GB，建议清理 .oneshot/ 旧日志与 pb_data 备份`
      : `磁盘占用 ${humanBytes(total)}（${breakdown}）`,
  })

  return {
    ok: !checks.some((c) => c.status === 'fail'),
    project: manifest?.config.name ?? null,
    target: target || null,
    checks,
  }
}
