import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { build } from 'esbuild'
import { resolveHandler, type ResolvedManifest } from './manifest.js'
import type { OneshotConfig } from './schema.js'

/**
 * sidecar：跑在真正 Node 进程里的 action handler。
 * PB 的 JSVM 路由通过 $http.send 把 {auth, token, query, body} 转发到控制服务器的
 * /sidecar/{service}/{action}，这里执行用户 handler 并返回结果。
 * handler 内拿 ctx.pbUrl / ctx.token 可回调 PB API（身份与规则原样生效）。
 */

const require_ = createRequire(import.meta.url)

export function sidecarTokenPath(root: string): string {
  return resolve(root, '.oneshot/sidecar-token')
}

export function getOrCreateSidecarToken(root: string): string {
  const path = sidecarTokenPath(root)
  if (existsSync(path)) {
    // 自愈：已存在的 token 母本把目录/文件权限强制收敛到 0700/0600（幂等，已正确时为无害系统调用）。
    // 绝不重生成内容 —— 旧 token 已烘焙进上次发布的 pb_hooks 产物，轮换会让 PB→sidecar 转发断链。
    const dir = resolve(root, '.oneshot')
    chmodSync(dir, 0o700)
    chmodSync(path, 0o600)
    return readFileSync(path, 'utf8').trim()
  }
  const token = randomBytes(24).toString('hex')
  // token 是服务间共享凭据：目录与文件都只给属主权限
  mkdirSync(resolve(root, '.oneshot'), { recursive: true, mode: 0o700 })
  writeFileSync(path, token, { mode: 0o600 })
  return token
}

export interface SidecarCtx {
  service: string
  action: string
  auth: { id: string } | null
  /** 当前用户的 PB auth token（转发自原始请求，规则与身份原样生效） */
  token: string
  /** 系统服务账号 token（副本流转/罚款结算等系统级写操作专用；librarian 角色） */
  systemToken: string
  pbUrl: string
  query: Record<string, any>
  body: Record<string, any>
}

type SidecarHandler = (ctx: SidecarCtx) => Promise<unknown> | unknown

export interface SidecarRegistry {
  handlers: Map<string, SidecarHandler>
  /** 参与 sidecar 的 {service, action, method} 清单（发布快照/日志用） */
  entries: { service: string; action: string; method: string; route: string }[]
}

/** 把所有 runtime: 'sidecar' 的 handler 用 esbuild 打包成独立 CJS 文件并加载（npm 包走 external） */
export async function buildSidecarRegistry(manifest: ResolvedManifest, outDir: string): Promise<SidecarRegistry> {
  const { config } = manifest
  mkdirSync(outDir, { recursive: true })
  const handlers = new Map<string, SidecarHandler>()
  const entries: SidecarRegistry['entries'] = []

  for (const svc of config.services) {
    for (const [actionName, action] of Object.entries(svc.actions ?? {})) {
      if (action.runtime !== 'sidecar') continue
      const { file, exportName } = resolveHandler(svc, actionName, manifest.root)
      const outfile = resolve(outDir, `${svc.name}.${actionName}.cjs`)
      await build({
        entryPoints: [file],
        outfile,
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'es2022',
        packages: 'external',
        legalComments: 'none',
        logLevel: 'silent',
      })
      const mod = require_(outfile)
      const fn = mod[exportName ?? actionName] ?? mod.default
      if (typeof fn !== 'function') {
        throw new Error(`sidecar handler 缺少具名导出：${svc.name}.${actionName} → ${basename(file)}#${exportName ?? actionName}`)
      }
      handlers.set(`${svc.name}/${actionName}`, fn as SidecarHandler)
      entries.push({
        service: svc.name,
        action: actionName,
        method: action.method ?? 'POST',
        route: `/api/oneshot/${svc.name}/${actionName}`,
      })
    }
  }
  return { handlers, entries }
}

export interface SidecarRequestResult {
  handled: boolean
  status?: number
  body?: unknown
}

/** 处理 /sidecar/{service}/{action} 请求；非 sidecar 路径返回 { handled: false } */
export async function handleSidecarRequest(
  registry: SidecarRegistry,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  opts: { token: string; pbUrl: string; systemToken?: string },
): Promise<SidecarRequestResult> {
  const url = new URL(req.url ?? '/', 'http://local')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'sidecar' || parts.length !== 3) return { handled: false }

  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const auth = req.headers.authorization ?? ''
  // 常量时间比较防时序侧信道；先比长度避免 timingSafeEqual 抛异常（长度不等本身已可判定）
  const expected = `Bearer ${opts.token}`
  const authOk = auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
  if (!authOk) {
    send(401, { error: 'invalid sidecar token' })
    return { handled: true, status: 401 }
  }

  const key = `${parts[1]}/${parts[2]}`
  const fn = registry.handlers.get(key)
  if (!fn) {
    send(404, { error: `unknown sidecar action: ${key}` })
    return { handled: true, status: 404 }
  }

  // 请求体上限 1MB（超出 413）；PB 的 $http.send 转发固定带 application/json
  let body: Record<string, any> = {}
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > 1024 * 1024) {
      send(413, { error: 'request body too large (max 1MB)' })
      return { handled: true, status: 413 }
    }
    chunks.push(chunk as Buffer)
  }
  if (chunks.length) {
    const contentType = String(req.headers['content-type'] ?? '')
    if (!contentType.includes('application/json')) {
      send(415, { error: `expected application/json, got: ${contentType || '(none)'}` })
      return { handled: true, status: 415 }
    }
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      send(400, { error: 'invalid JSON body' })
      return { handled: true, status: 400 }
    }
  }

  const payload = body as { auth?: { id: string } | null; token?: string; query?: Record<string, any>; body?: Record<string, any> }
  try {
    const result = await fn({
      service: parts[1],
      action: parts[2],
      auth: payload.auth ?? null,
      token: payload.token ?? '',
      systemToken: opts.systemToken ?? '',
      pbUrl: opts.pbUrl,
      query: payload.query ?? {},
      body: (payload.body as Record<string, any>) ?? {},
    } satisfies SidecarCtx)
    send(200, result === undefined ? {} : result)
    return { handled: true, status: 200 }
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 500
    send(status, { error: err?.message ?? String(err) })
    return { handled: true, status }
  }
}


const SERVICE_EMAIL = 'oneshot-service@system.local'

/** 确保系统服务账号存在并返回长效 impersonate token（sidecar 的系统级操作凭据：
 *  副本状态流转、罚款结算等读者无权直改、但业务动作必须执行的写操作）。
 *  账号 role 由调用方（provisioner）以超管身份设置为 librarian。 */
export async function ensureServiceAccount(
  pb: { request: (m: string, p: string, b?: unknown) => Promise<any>; listRecords: (c: string, q?: string) => Promise<any>; createRecord: (c: string, b: unknown) => Promise<any>; updateRecord: (c: string, id: string, b: unknown) => Promise<any> },
  authCollection: string,
  root: string,
): Promise<string> {
  const exists = await pb.listRecords(authCollection, `?filter=${encodeURIComponent(`email = "${SERVICE_EMAIL}"`)}&perPage=1`)
  let id: string = exists.items?.[0]?.id
  if (!id) {
    const created = await pb.createRecord(authCollection, {
      email: SERVICE_EMAIL, password: cryptoRandom(24), passwordConfirm: undefined, role: 'librarian', blocked: false,
    } as any).catch(async () => {
      // auth collection 注册可能要求 passwordConfirm
      const pwd = cryptoRandom(24)
      return pb.createRecord(authCollection, { email: SERVICE_EMAIL, password: pwd, passwordConfirm: pwd, role: 'librarian', blocked: false } as any)
    })
    id = created.id
  } else {
    await pb.updateRecord(authCollection, id, { role: 'librarian', blocked: false }).catch(() => {})
  }
  const imp = await pb.request('POST', `/api/collections/${authCollection}/impersonate/${id}`, { duration: 31536000 })
  const token = imp.token as string
  writeFileSync(resolve(root, '.oneshot/service-account-token'), token, { mode: 0o600 })
  return token
}

/** 读取 service account token（控制服务器每次请求时读，热更新） */
export function readServiceAccountToken(root: string): string {
  try {
    return String(readFileSync(resolve(root, '.oneshot/service-account-token'), 'utf8')).trim()
  } catch { return '' }
}

function cryptoRandom(n: number): string {
  return randomBytes(n).toString('hex')
}

export function hasSidecarActions(config: OneshotConfig): boolean {
  return config.services.some((svc) =>
    Object.values(svc.actions ?? {}).some((a) => a.runtime === 'sidecar'),
  )
}
