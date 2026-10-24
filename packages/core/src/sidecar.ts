import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  const token = randomBytes(24).toString('hex')
  mkdirSync(resolve(root, '.oneshot'), { recursive: true })
  writeFileSync(path, token)
  return token
}

export interface SidecarCtx {
  service: string
  action: string
  auth: { id: string } | null
  /** 当前用户的 PB auth token（转发自原始请求，规则与身份原样生效） */
  token: string
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
  opts: { token: string; pbUrl: string },
): Promise<SidecarRequestResult> {
  const url = new URL(req.url ?? '/', 'http://local')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'sidecar' || parts.length !== 3) return { handled: false }

  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${opts.token}`) {
    send(401, { error: 'invalid sidecar token' })
    return { handled: true, status: 401 }
  }

  const key = `${parts[1]}/${parts[2]}`
  const fn = registry.handlers.get(key)
  if (!fn) {
    send(404, { error: `unknown sidecar action: ${key}` })
    return { handled: true, status: 404 }
  }

  let body: Record<string, any> = {}
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length) {
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

export function hasSidecarActions(config: OneshotConfig): boolean {
  return config.services.some((svc) =>
    Object.values(svc.actions ?? {}).some((a) => a.runtime === 'sidecar'),
  )
}
