import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { build } from 'esbuild'
import { resolveHandler, type ResolvedManifest } from './manifest.js'
import { SERVICE_ACCOUNT_EMAIL } from './pb-mapping.js'
import {
  isJsonObject,
  sidecarErrorMessage,
  sidecarErrorStatus,
  type JsonObject,
  type SidecarCtx,
  type SidecarHandler,
} from './action-runtime.js'
import type { OneshotConfig } from './schema.js'

export { defineSidecarAction, SidecarActionError, sidecarErrorMessage, sidecarErrorStatus, withSidecarLocks } from './action-runtime.js'
export type { JsonObject, JsonValue, SidecarCtx, SidecarHandler } from './action-runtime.js'

const require_ = createRequire(import.meta.url)

export function sidecarTokenPath(root: string): string {
  return resolve(root, '.oneshot/sidecar-token')
}

export function getOrCreateSidecarToken(root: string): string {
  const path = sidecarTokenPath(root)
  if (existsSync(path)) {
    const dir = resolve(root, '.oneshot')
    chmodSync(dir, 0o700)
    chmodSync(path, 0o600)
    return readFileSync(path, 'utf8').trim()
  }
  const token = randomBytes(24).toString('hex')
  mkdirSync(resolve(root, '.oneshot'), { recursive: true, mode: 0o700 })
  writeFileSync(path, token, { mode: 0o600 })
  return token
}

export interface SidecarRegistry {
  handlers: Map<string, SidecarHandler>
  entries: { service: string; action: string; method: string; route: string }[]
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 sidecar handler 打包成独立 CJS 并加载（npm 包保持 external）。 */
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
      const loaded: unknown = require_(outfile)
      if (!isUnknownObject(loaded)) throw new Error(`sidecar handler 模块无效：${svc.name}.${actionName}`)
      const candidate = loaded[exportName ?? actionName] ?? loaded.default
      if (typeof candidate !== 'function') {
        throw new Error(`sidecar handler 缺少具名导出：${svc.name}.${actionName} → ${basename(file)}#${exportName ?? actionName}`)
      }
      const fn = candidate as SidecarHandler
      handlers.set(`${svc.name}/${actionName}`, fn)
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

/** 处理 /sidecar/{service}/{action} 请求；非 sidecar 路径返回 { handled: false }。 */
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

  let raw: unknown = {}
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
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      send(400, { error: 'invalid JSON body' })
      return { handled: true, status: 400 }
    }
  }
  if (!isJsonObject(raw)) {
    send(400, { error: 'sidecar payload must be a JSON object' })
    return { handled: true, status: 400 }
  }

  const payloadAuth = isJsonObject(raw.auth) && typeof raw.auth.id === 'string'
    ? { id: raw.auth.id }
    : null
  const token = typeof raw.token === 'string' ? raw.token : ''
  const query: JsonObject = isJsonObject(raw.query) ? raw.query : {}
  const body: JsonObject = isJsonObject(raw.body) ? raw.body : {}

  try {
    const result = await fn({
      service: parts[1],
      action: parts[2],
      auth: payloadAuth,
      token,
      systemToken: opts.systemToken ?? '',
      pbUrl: opts.pbUrl,
      query,
      body,
    } satisfies SidecarCtx)
    send(200, result === undefined ? {} : result)
    return { handled: true, status: 200 }
  } catch (error: unknown) {
    const status = sidecarErrorStatus(error)
    send(status, { error: sidecarErrorMessage(error) })
    return { handled: true, status }
  }
}

const SERVICE_EMAIL = SERVICE_ACCOUNT_EMAIL

interface ServiceAccountAdmin {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>
  listRecords(collection: string, query?: string): Promise<{ items?: unknown[]; totalItems?: number }>
  createRecord(collection: string, body: unknown): Promise<unknown>
  updateRecord(collection: string, id: string, body: unknown): Promise<unknown>
}

function recordId(value: unknown): string | undefined {
  return isUnknownObject(value) && typeof value.id === 'string' ? value.id : undefined
}

function tokenValue(value: unknown): string {
  if (!isUnknownObject(value) || typeof value.token !== 'string' || !value.token) {
    throw new Error('PocketBase 未返回有效的服务账号 token')
  }
  return value.token
}

/** 确保系统服务账号存在并返回长效 impersonate token。 */
export async function ensureServiceAccount(
  pb: ServiceAccountAdmin,
  authCollection: string,
  root: string,
): Promise<string> {
  const exists = await pb.listRecords(authCollection, `?filter=${encodeURIComponent(`email = "${SERVICE_EMAIL}"`)}&perPage=1`)
  let id = recordId(exists.items?.[0])
  if (!id) {
    const password = cryptoRandom(24)
    const created = await pb.createRecord(authCollection, {
      email: SERVICE_EMAIL,
      password,
      passwordConfirm: password,
      role: 'librarian',
      blocked: false,
    })
    id = recordId(created)
    if (!id) throw new Error('系统服务账号创建后未返回记录 id')
  } else {
    await pb.updateRecord(authCollection, id, { role: 'librarian', blocked: false }).catch(() => {})
  }
  const imp = await pb.request('POST', `/api/collections/${authCollection}/impersonate/${id}`, { duration: 31536000 })
  const token = tokenValue(imp)
  mkdirSync(resolve(root, '.oneshot'), { recursive: true, mode: 0o700 })
  const tokenPath = resolve(root, '.oneshot/service-account-token')
  writeFileSync(tokenPath, token, { mode: 0o600 })
  chmodSync(tokenPath, 0o600)
  return token
}

export function readServiceAccountToken(root: string): string {
  try {
    return String(readFileSync(resolve(root, '.oneshot/service-account-token'), 'utf8')).trim()
  } catch {
    return ''
  }
}

function cryptoRandom(n: number): string {
  return randomBytes(n).toString('hex')
}

export function hasSidecarActions(config: OneshotConfig): boolean {
  return config.services.some((svc) =>
    Object.values(svc.actions ?? {}).some((action) => action.runtime === 'sidecar'),
  )
}
