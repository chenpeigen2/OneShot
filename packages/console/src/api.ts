/** 控制台直连 PocketBase 的最小 API 封装（只读 + 超管登录） */

let baseUrl = localStorage.getItem('oneshot_pb_url') ?? ''
let token = sessionStorage.getItem('oneshot_pb_token') ?? ''

export function pbUrl(): string {
  return baseUrl
}

export function isAuthed(): boolean {
  return !!token && !!baseUrl
}

export function logout(): void {
  token = ''
  sessionStorage.removeItem('oneshot_pb_token')
}

export async function login(url: string, email: string, password: string): Promise<void> {
  const u = url.replace(/\/+$/, '')
  const res = await fetch(`${u}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? `登录失败（HTTP ${res.status}）`)
  baseUrl = u
  token = data.token
  localStorage.setItem('oneshot_pb_url', u)
  sessionStorage.setItem('oneshot_pb_token', token)
}

async function pb<T = any>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: token } : {},
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    if (res.status === 401) logout()
    throw new Error(err?.message ?? `HTTP ${res.status} — ${path}`)
  }
  return res.json() as Promise<T>
}

export interface PbCollection {
  id: string
  name: string
  type: 'base' | 'view' | 'auth'
  system: boolean
  fields: { name: string; type: string; presentable?: boolean }[]
}

export const fetchCollections = () => pb<{ items: PbCollection[] }>('/api/collections?perPage=200&sort=name')

export interface MetaRecord {
  id: string
  project: string
  snapshot: {
    hash: string
    publishedAt: string
    services: {
      name: string
      title?: string
      hasHooks: boolean
      collections: { name: string; fields: string[] }[]
      actions: { name: string; method: string; route: string }[]
    }[]
  }
}

export const fetchMeta = () => pb<{ items: MetaRecord[] }>('/api/collections/oneshot_meta/records?perPage=5')

export const fetchRecords = (coll: string, page: number, perPage: number, sort = '-created') =>
  pb<{ items: any[]; totalItems: number; totalPages: number }>(
    `/api/collections/${coll}/records?page=${page}&perPage=${perPage}&sort=${sort}`,
  )

export function fileUrl(coll: string, recordId: string, filename: string): string {
  return `${baseUrl}/api/files/${coll}/${recordId}/${filename}`
}

// ---------- 控制服务器 API（同源 7860：manifest 写回等） ----------

async function ctrl<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status} — ${path}`)
  return data as T
}

export const fetchManifest = () => ctrl<{ config: any; path: string }>('/api/manifest')

// ---------- 备份（PB 原生 backups API，超管） ----------

export const fetchBackups = () => pb<any[]>('/api/backups')

export const createBackup = (name?: string) => {
  const clean = name?.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '')
  const finalName = clean ? `${clean}.zip` : undefined
  return pb('/api/backups', { method: 'POST', body: finalName ? { name: finalName } : {} })
}

export async function deleteBackup(name: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/backups/${encodeURIComponent(name)}`, {
    method: 'DELETE', headers: token ? { Authorization: token } : {},
  })
  if (!res.ok) throw new Error(`删除失败（HTTP ${res.status}）`)
}

export async function restoreBackup(name: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/backups/${encodeURIComponent(name)}/restore`, {
    method: 'POST', headers: token ? { Authorization: token } : {},
  })
  if (!res.ok) throw new Error(`恢复失败（HTTP ${res.status}）—— 恢复会重启 PB，稍后刷新`)
}

export async function downloadBackup(name: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/backups/${encodeURIComponent(name)}`, {
    headers: token ? { Authorization: token } : {},
  })
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.zip') ? name : name + '.zip'
  a.click()
  URL.revokeObjectURL(url)
}

export const saveManifest = (config: any) =>
  ctrl<{ report: { created: string[]; updated: string[]; unchanged: string[]; pruned: string[]; hooksFiles: string[]; clientsDirs: string[]; snapshotHash: string } }>(
    '/api/manifest',
    { method: 'POST', body: { config } },
  )
