import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CollectionDef, FieldSpec, OneshotConfig } from '../schema.js'

function pascal(name: string): string {
  return name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('')
}

function tsType(spec: FieldSpec): string {
  switch (spec.kind) {
    case 'text': case 'email': case 'url': case 'editor': case 'date': return 'string'
    case 'number': return 'number'
    case 'bool': return 'boolean'
    case 'select': {
      const values = spec.options.values ?? []
      if (!values.length) return spec.options.multi ? 'string[]' : 'string'
      const union = values.map((value) => JSON.stringify(value)).join(' | ')
      return spec.options.multi ? `Array<${union}>` : union
    }
    case 'json': return 'unknown'
    case 'file': return (spec.options.multi || (spec.options.maxSelect ?? 1) > 1) ? 'string[]' : 'string'
    case 'relation': return spec.options.multi ? 'string[]' : 'string'
    case 'geoPoint': return '{ lat: number; lon: number }'
  }
}

export interface TsGenResult {
  dir: string
  files: { name: string; content: string }[]
}

export function buildTsClient(config: OneshotConfig, outDir: string): TsGenResult {
  const header = '// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen\n'
  const authCollection = config.auth?.collection ?? 'users'

  // ---------- schema.ts ----------
  const schemaLines: string[] = [header]
  schemaLines.push(`export interface BaseRecord {\n  id: string\n  created: string\n  updated: string\n  collectionId: string\n  collectionName: string\n}\n`)
  schemaLines.push(`export interface ${pascal(authCollection)}Record extends BaseRecord {`)
  schemaLines.push('  email?: string\n  emailVisibility?: boolean\n  verified?: boolean\n  name?: string\n  avatar?: string')
  for (const [fieldName, spec] of Object.entries(config.auth?.fields ?? {})) {
    if (fieldName !== 'name' && fieldName !== 'avatar') schemaLines.push(`  ${fieldName}: ${tsType(spec)}`)
  }
  schemaLines.push('}\n')
  const managed = config.auth?.managed ?? []
  const registerBase = managed.length
    ? `Omit<Partial<${pascal(authCollection)}Record>, ${managed.map((field) => JSON.stringify(field)).join(' | ')}>`
    : `Partial<${pascal(authCollection)}Record>`
  schemaLines.push(`export type ${pascal(authCollection)}RegisterInput = ${registerBase} & { email: string; password: string; passwordConfirm: string }\n`)
  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      schemaLines.push(`export interface ${pascal(collName)}Record extends BaseRecord {`)
      for (const [fieldName, spec] of Object.entries(def.fields ?? {})) {
        schemaLines.push(`  ${fieldName}: ${tsType(spec)}`)
      }
      schemaLines.push('}\n')
    }
  }

  // ---------- client.ts ----------
  const clientLines: string[] = [header]
  clientLines.push(`import PocketBase from 'pocketbase'`)
  clientLines.push(`import type { RecordOptions, RecordFullListOptions, RecordListOptions } from 'pocketbase'`)
  const recordTypes = [pascal(authCollection), ...config.services.flatMap((s) => Object.keys(s.collections).map(pascal))]
  clientLines.push(`import type { ${recordTypes.map((t) => `${t}Record`).join(', ')} } from './schema'`)
  clientLines.push(`import type { ${pascal(authCollection)}RegisterInput } from './schema'\n`)
  clientLines.push(`export { PocketBase }`)
  clientLines.push(`export type { RecordModel, ListResult } from 'pocketbase'`)
  clientLines.push(`export * from './schema'\n`)

  // UsersApi
  clientLines.push(`export class ${pascal(authCollection)}Api {`)
  clientLines.push(`  constructor(readonly pb: PocketBase) {}`)
  clientLines.push(`  private get coll() { return this.pb.collection('${authCollection}') }`)
  clientLines.push(`  async login(email: string, password: string): Promise<${pascal(authCollection)}Record> {`)
  clientLines.push(`    const auth = await this.coll.authWithPassword(email, password)`)
  clientLines.push(`    return auth.record as ${pascal(authCollection)}Record`)
  clientLines.push(`  }`)
  clientLines.push(`  get me(): ${pascal(authCollection)}Record | null {`)
  clientLines.push(`    return (this.pb.authStore.record as ${pascal(authCollection)}Record | null) ?? null`)
  clientLines.push(`  }`)
  clientLines.push(`  register(data: ${pascal(authCollection)}RegisterInput, options: RecordOptions = {}) {`)
  clientLines.push(`    return this.coll.create<${pascal(authCollection)}Record>(data, options)`)
  clientLines.push(`  }`)
  clientLines.push(`  logout() { this.pb.authStore.clear() }`)
  clientLines.push(`}\n`)

  // 每个 collection 的 Api 类
  const apiProps: string[] = []
  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      const cls = `${pascal(collName)}Api`
      apiProps.push(`  ${collName}: ${cls}`)
      clientLines.push(`export class ${cls} {`)
      clientLines.push(`  constructor(readonly pb: PocketBase) {}`)
      clientLines.push(`  private get coll() { return this.pb.collection('${collName}') }`)
      clientLines.push(`  list(page = 1, perPage = 20, options: RecordListOptions = {}) {`)
      clientLines.push(`    return this.coll.getList<${pascal(collName)}Record>(page, perPage, options)`)
      clientLines.push(`  }`)
      clientLines.push(`  all(options: RecordFullListOptions = {}) {`)
      clientLines.push(`    return this.coll.getFullList<${pascal(collName)}Record>(options)`)
      clientLines.push(`  }`)
      clientLines.push(`  one(id: string, options: RecordOptions = {}) {`)
      clientLines.push(`    return this.coll.getOne<${pascal(collName)}Record>(id, options)`)
      clientLines.push(`  }`)
      clientLines.push(`  create(data: Partial<${pascal(collName)}Record>, options: RecordOptions = {}) {`)
      clientLines.push(`    return this.coll.create<${pascal(collName)}Record>(data, options)`)
      clientLines.push(`  }`)
      clientLines.push(`  update(id: string, data: Partial<${pascal(collName)}Record>, options: RecordOptions = {}) {`)
      clientLines.push(`    return this.coll.update<${pascal(collName)}Record>(id, data, options)`)
      clientLines.push(`  }`)
      clientLines.push(`  remove(id: string, options: RecordOptions = {}) {`)
      clientLines.push(`    return this.coll.delete(id, options)`)
      clientLines.push(`  }`)
      for (const [actionName, action] of Object.entries(svc.actions ?? {})) {
        const hasBody = (action.method ?? 'POST') !== 'GET'
        clientLines.push(`  ${actionName}(body${hasBody ? '' : '_'}: Record<string, unknown> = {}, query: Record<string, string> = {}) {`)
        clientLines.push(`    return this.pb.send('/api/oneshot/${svc.name}/${actionName}', { method: '${action.method ?? 'POST'}', body: ${hasBody ? 'body' : 'undefined'}, query }) as Promise<unknown>`)
        clientLines.push(`  }`)
      }
      clientLines.push('}\n')
    }
  }

  clientLines.push(`export interface OneShotClient {`)
  clientLines.push(`  pb: PocketBase`)
  clientLines.push(`  ${authCollection}: ${pascal(authCollection)}Api`)
  for (const p of apiProps) clientLines.push(p)
  clientLines.push(`}\n`)
  clientLines.push(`export function createClient(baseUrl: string): OneShotClient {`)
  clientLines.push(`  const pb = new PocketBase(baseUrl)`)
  clientLines.push(`  return {`)
  clientLines.push(`    pb,`)
  clientLines.push(`    ${authCollection}: new ${pascal(authCollection)}Api(pb),`)
  for (const svc of config.services) {
    for (const collName of Object.keys(svc.collections)) {
      clientLines.push(`    ${collName}: new ${pascal(collName)}Api(pb),`)
    }
  }
  clientLines.push(`  }`)
  clientLines.push(`}\n`)

  // ---------- react.tsx ----------
  const reactLines: string[] = [header]
  reactLines.push(`import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'`)
  reactLines.push(`import type { ReactNode } from 'react'`)
  reactLines.push(`import PocketBase from 'pocketbase'`)
  reactLines.push(`import type { RecordListOptions, RecordModel } from 'pocketbase'`)
  reactLines.push(`import type { OneShotClient } from './client'`)
  reactLines.push(`import type { ${pascal(authCollection)}Record, ${pascal(authCollection)}RegisterInput } from './schema'`)
  reactLines.push(`import { createClient } from './client'\n`)
  reactLines.push(`const ClientContext = createContext<OneShotClient | null>(null)`)
  reactLines.push(`const DEFAULT_BASE_URL = typeof window !== 'undefined' && !window.location.origin.includes('localhost') ? window.location.origin : 'http://127.0.0.1:8090'\n`)
  reactLines.push(`export function OneShotProvider({ client, baseUrl, children }: { client?: OneShotClient; baseUrl?: string; children: ReactNode }) {`)
  reactLines.push(`  const value = useMemo(`)
  reactLines.push(`    () => client ?? createClient(baseUrl ?? DEFAULT_BASE_URL),`)
  reactLines.push(`    [client, baseUrl],`)
  reactLines.push(`  )`)
  reactLines.push(`  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>`)
  reactLines.push(`}\n`)
  reactLines.push(`export function useClient(): OneShotClient {`)
  reactLines.push(`  const client = useContext(ClientContext)`)
  reactLines.push(`  if (!client) throw new Error('useClient 必须在 <OneShotProvider> 内使用')`)
  reactLines.push(`  return client`)
  reactLines.push(`}`)
  reactLines.push(`export function usePB(): PocketBase {`)
  reactLines.push(`  return useClient().pb`)
  reactLines.push(`}\n`)
  reactLines.push(`export function useAuth<T extends RecordModel = ${pascal(authCollection)}Record>() {`)
  reactLines.push(`  const pb = usePB()`)
  reactLines.push(`  const [record, setRecord] = useState<T | null>(() => (pb.authStore.record as T | null))`)
  reactLines.push(`  useEffect(() => pb.authStore.onChange(() => setRecord(pb.authStore.record as T | null)), [pb])`)
  reactLines.push(`  const login = useCallback(`)
  reactLines.push(`    (email: string, password: string) => pb.collection('${authCollection}').authWithPassword(email, password),`)
  reactLines.push(`    [pb],`)
  reactLines.push(`  )`)
  reactLines.push(`  const register = useCallback(`)
  reactLines.push(`    (data: ${pascal(authCollection)}RegisterInput) => pb.collection('${authCollection}').create(data),`)
  reactLines.push(`    [pb],`)
  reactLines.push(`  )`)
  reactLines.push(`  const logout = useCallback(() => pb.authStore.clear(), [pb])`)
  reactLines.push(`  const refresh = useCallback(async () => { await pb.collection('${authCollection}').authRefresh() }, [pb])`)
  reactLines.push(`  return { user: record as T | null, token: pb.authStore.token, login, register, logout, refresh }`)
  reactLines.push(`}\n`)
  reactLines.push(`export function useRecords<T extends RecordModel = RecordModel>(collection: string, options: RecordListOptions = {}, page = 1, perPage = 20) {`)
  reactLines.push(`  const pb = usePB()`)
  reactLines.push(`  const [items, setItems] = useState<T[]>([])`)
  reactLines.push(`  const [total, setTotal] = useState(0)`)
  reactLines.push(`  const [loading, setLoading] = useState(true)`)
  reactLines.push(`  const [error, setError] = useState<unknown>(null)`)
  reactLines.push(`  const optionsKey = JSON.stringify(options ?? {})`)
  reactLines.push(`  const requestSeq = useRef(0)`)
  reactLines.push(`  const reload = useCallback(async () => {`)
  reactLines.push(`    const seq = ++requestSeq.current`)
  reactLines.push(`    setLoading(true)`)
  reactLines.push(`    try {`)
  reactLines.push(`      const res = await pb.collection(collection).getList<T>(page, perPage, { ...JSON.parse(optionsKey), requestKey: null })`)
  reactLines.push(`      if (seq !== requestSeq.current) return`)
  reactLines.push(`      setItems(res.items)`)
  reactLines.push(`      setTotal(res.totalItems)`)
  reactLines.push(`      setError(null)`)
  reactLines.push(`    } catch (err) {`)
  reactLines.push(`      if (seq === requestSeq.current) setError(err)`)
  reactLines.push(`    } finally {`)
  reactLines.push(`      if (seq === requestSeq.current) setLoading(false)`)
  reactLines.push(`    }`)
  reactLines.push(`  }, [pb, collection, page, perPage, optionsKey])`)
  reactLines.push(`  useEffect(() => {`)
  reactLines.push(`    let alive = true`)
  reactLines.push(`    let unsub: (() => void) | undefined`)
  reactLines.push(`    reload()`)
  reactLines.push(`    pb.collection(collection)`)
  reactLines.push(`      .subscribe('*', () => { if (alive) reload() })`)
  reactLines.push(`      .then((fn) => { if (!alive) fn(); else unsub = fn })`)
  reactLines.push(`      .catch((err) => { if (alive) setError(err) })`)
  reactLines.push(`    return () => {`)
  reactLines.push(`      alive = false`)
  reactLines.push(`      requestSeq.current++`)
  reactLines.push(`      unsub?.()`)
  reactLines.push(`    }`)
  reactLines.push(`  }, [reload])`)
  reactLines.push(`  return { items, total, loading, error, reload }`)
  reactLines.push(`}\n`)

  return {
    dir: outDir,
    files: [
      { name: 'schema.ts', content: schemaLines.join('\n') },
      { name: 'client.ts', content: clientLines.join('\n') },
      { name: 'react.tsx', content: reactLines.join('\n') },
    ],
  }
}

export async function writeTsClient(config: OneshotConfig, root: string, outDir: string): Promise<string> {
  const abs = resolve(root, outDir)
  const result = buildTsClient(config, abs)
  await mkdir(abs, { recursive: true })
  for (const f of result.files) {
    await writeFile(resolve(abs, f.name), f.content, 'utf8')
  }
  return abs
}

/** 供 dart 生成器复用的工具 */
export { pascal }
export type { CollectionDef }
