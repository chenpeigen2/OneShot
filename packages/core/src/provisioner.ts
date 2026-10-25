import { resolve as resolvePath } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { CollectionDef, OneshotConfig } from './schema.js'
import {
  buildAuthCollectionCreate,
  buildFields,
  buildSnapshot,
  collectionSatisfied,
  findOwnerField,
  mergeFields,
  resolveRules,
  snapshotHash,
  type PbCollection,
  type PbField,
} from './pb-mapping.js'
import { buildAuthDefaultsEntry, compileServiceHooks, pruneStaleHooks } from './hooks-compiler.js'
import { generateClients } from './codegen/index.js'
import { ensureServiceAccount, getOrCreateSidecarToken } from './sidecar.js'
import type { ResolvedManifest } from './manifest.js'

// ---------- PB Admin API 客户端 ----------

export class PocketBaseError extends Error {
  constructor(readonly status: number, readonly url: string, readonly body: string) {
    super(`PocketBase ${status} ${url}: ${body}`)
  }
}

export class PocketBaseAdmin {
  token: string | null = null

  constructor(readonly baseUrl: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: this.token } : {}),
      ...extra,
    }
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new PocketBaseError(res.status, path, text)
    return (text ? JSON.parse(text) : {}) as T
  }

  async health(): Promise<void> {
    await this.request('GET', '/api/health')
  }

  async authWithPassword(identity: string, password: string): Promise<void> {
    const res = await this.request<{ token: string }>(
      'POST', '/api/collections/_superusers/auth-with-password', { identity, password },
    )
    this.token = res.token
  }

  async listCollections(): Promise<PbCollection[]> {
    const out: PbCollection[] = []
    let page = 1
    for (;;) {
      const res = await this.request<{ items: PbCollection[]; totalPages: number }>(
        'GET', `/api/collections?page=${page}&perPage=200`,
      )
      out.push(...res.items)
      if (page >= res.totalPages) break
      page++
    }
    return out
  }

  createCollection(body: unknown) { return this.request('POST', '/api/collections', body) }
  updateCollection(idOrName: string, body: unknown) { return this.request('PATCH', `/api/collections/${idOrName}`, body) }
  deleteCollection(idOrName: string) { return this.request('DELETE', `/api/collections/${idOrName}`) }

  async listRecords(collection: string, query = ''): Promise<{ items: any[]; totalItems: number }> {
    return this.request('GET', `/api/collections/${collection}/records${query}`)
  }
  createRecord(collection: string, body: unknown) {
    return this.request('POST', `/api/collections/${collection}/records`, body)
  }
  updateRecord(collection: string, id: string, body: unknown) {
    return this.request('PATCH', `/api/collections/${collection}/records/${id}`, body)
  }
}

// ---------- 发布编排 ----------

export interface PublishOptions {
  manifest: ResolvedManifest
  superuserEmail?: string
  superuserPassword?: string
  /** 已持有的超管 token（控制台代发场景），优先于 email/password */
  superuserToken?: string
  /** 目标环境（manifest.environments 的键）；未指定用顶层 baseUrl */
  env?: string
  /** hooks 编译输出目录，默认 <项目根>/pb_hooks（与 `oneshot engine up` 的 --hooksDir 一致） */
  hooksDir?: string
  /** 删除 manifest 中已不存在（且由上一次发布记录）的 collection */
  prune?: boolean
  /** 发布后自动运行客户端代码生成，默认 true */
  gen?: boolean
  log?: (msg: string) => void
}

export interface PublishReport {
  baseUrl: string
  created: string[]
  updated: string[]
  unchanged: string[]
  pruned: string[]
  /** 本次实际灌入的种子（collection:key）；幂等重放时为空 */
  seeded: string[]
  hooksFiles: string[]
  clientsDirs: string[]
  snapshotHash: string
  publishedAt: string
}

const META_COLLECTION = 'oneshot_meta'

export async function publish(opts: PublishOptions): Promise<PublishReport> {
  const { manifest } = opts
  const config = manifest.config
  const log = opts.log ?? (() => {})
  const envBlock = opts.env ? config.environments?.[opts.env] : undefined
  if (opts.env && !envBlock) {
    throw new Error(`未知环境 "${opts.env}"（manifest 未定义 environments.${opts.env}）`)
  }
  const baseUrl = process.env.ONESHOT_PB_URL || envBlock?.baseUrl || config.baseUrl
  if (!baseUrl) throw new Error('缺少 PocketBase 地址：设置 ONESHOT_PB_URL、environments.<env>.baseUrl 或在 manifest 里写 baseUrl')

  const pb = new PocketBaseAdmin(baseUrl.replace(/\/$/, ''))
  try {
    await pb.health()
  } catch (err: any) {
    throw new Error(`PocketBase 不可达（${baseUrl}）：${err?.cause?.message ?? err?.message ?? err}`)
  }
  if (opts.superuserToken) {
    pb.token = opts.superuserToken
  } else {
    if (!opts.superuserEmail || !opts.superuserPassword) {
      throw new Error('缺少超管凭据（ONESHOT_SUPERUSER_EMAIL / ONESHOT_SUPERUSER_PASSWORD）')
    }
    await pb.authWithPassword(opts.superuserEmail, opts.superuserPassword)
  }

  const authCollectionName = config.auth?.collection ?? 'users'
  const existingList = await pb.listCollections()
  const existing = new Map(existingList.map((c) => [c.name, c]))
  const collectionIds = new Map(existingList.map((c) => [c.name, c.id]))

  const report: PublishReport = {
    baseUrl, created: [], updated: [], unchanged: [], pruned: [], seeded: [], hooksFiles: [], clientsDirs: [],
    snapshotHash: '', publishedAt: new Date().toISOString(),
  }

  const ensureCollection = async (name: string, desired: DesiredCollection, createExtra: Record<string, unknown> = {}): Promise<void> => {
    const current = existing.get(name)
    if (!current) {
      const body = { name, ...desired, ...createExtra }
      const created = await pb.createCollection(body)
      existing.set(name, created as PbCollection)
      collectionIds.set(name, created.id)
      report.created.push(name)
      log(`  + collection ${name} 已创建`)
      return
    }
    if (collectionSatisfied(current, desired)) {
      report.unchanged.push(name)
      return
    }
    const mergedFields = mergeFields(current.fields, desired.fields)
    await pb.updateCollection(current.id, {
      fields: mergedFields,
      indexes: desired.indexes,
      listRule: desired.listRule ?? null,
      viewRule: desired.viewRule ?? null,
      createRule: desired.createRule ?? null,
      updateRule: desired.updateRule ?? null,
      deleteRule: desired.deleteRule ?? null,
    })
    report.updated.push(name)
    log(`  ~ collection ${name} 已更新`)
  }

  // 1) auth collection（先建，relation 依赖它）—— 始终 ensure（缺 config.auth 也要保证 users 存在，relation 依赖）
  {
    const signup = config.auth?.signup ?? 'public'
    const authBody = buildAuthCollectionCreate(authCollectionName, signup, config.auth?.fields, {
      listRule: config.auth?.listRule,
      viewRule: config.auth?.viewRule,
      updateRule: config.auth?.updateRule,
    }) as Record<string, unknown>
    const { passwordAuth, ...authDesired } = authBody
    await ensureCollection(authCollectionName, authDesired as any, { passwordAuth })
  }

  // 2) oneshot_meta（发布状态记录，供控制台/CLI 读取）
  if (!existing.has(META_COLLECTION)) {
    const created = await pb.createCollection({
      name: META_COLLECTION,
      type: 'base',
      fields: [
        { type: 'text', name: 'project', required: true },
        { type: 'json', name: 'snapshot', maxSize: 4_000_000 },
      ],
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    })
    existing.set(META_COLLECTION, created as PbCollection)
    collectionIds.set(META_COLLECTION, created.id)
    report.created.push(META_COLLECTION)
  }

  const collectionIdOf = (name: string): string | undefined => collectionIds.get(name)

  // 3) 第一遍：只保证 collection 存在（不挂规则，避免引用未创建的 relation 字段），拿到全部 collectionId
  const pendingRelations: { name: string; def: CollectionDef }[] = []
  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      if (!existing.has(collName)) {
        const desired = buildDesiredCollection(collName, def, authCollectionName, collectionIdOf, false, false)
        const { relationCount, ...createBody } = desired
        void relationCount
        const created = await pb.createCollection({ name: collName, ...createBody } as Record<string, unknown>)
        existing.set(collName, created as PbCollection)
        collectionIds.set(collName, created.id)
        report.created.push(collName)
        log(`  + collection ${collName} 已创建`)
      }
      if (Object.values(def.fields ?? {}).some((f) => f.kind === 'relation')) {
        pendingRelations.push({ name: collName, def })
      }
    }
  }

  // 4) 第二遍：完整同步（字段含 relation + 规则 + 索引），只在有实际差异时 PATCH
  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      const current = existing.get(collName)!
      const desired = buildDesiredCollection(collName, def, authCollectionName, collectionIdOf, true, true)
      if (collectionSatisfied(current, desired)) {
        report.unchanged.push(collName)
        continue
      }
      const { relationCount, ...full } = desired
      void relationCount
      const mergedFields = mergeFields(current.fields, full.fields)
      // 预检：PB 不允许原地改字段类型 —— 给出可行动的错误而不是裸 400
      const typeChanges = current.fields
        .map((f: any) => {
          const next = mergedFields.find((m: any) => m.name === f.name)
          return next && next.type !== f.type ? `${f.name}: ${f.type} → ${next.type}` : null
        })
        .filter(Boolean)
      if (typeChanges.length) {
        throw new Error(`collection "${collName}" 存在类型冲突字段（PocketBase 不支持原地改类型，请换字段名或先在 PB Admin UI 手动迁移）：${typeChanges.join('；')}`)
      }
      try {
        await pb.updateCollection(current.id, {
          fields: mergedFields,
          indexes: full.indexes,
          listRule: full.listRule ?? null,
          viewRule: full.viewRule ?? null,
          createRule: full.createRule ?? null,
          updateRule: full.updateRule ?? null,
          deleteRule: full.deleteRule ?? null,
        })
      } catch (err: any) {
        // 诊断：fields 逐位对比（定位 type change 类错误的真实差异）
        const detail = current.fields.map((f: any, i: number) => {
          const next = mergedFields[i]
          return `${i}: ${f.type}:${f.name}#${f.id ?? ''} -> ${next ? `${next.type}:${next.name}#${next.id ?? ''}` : '(none)'}`
        })
        err.message = `${err.message}\n[诊断 ${collName}] 现有 vs 发送:\n${detail.join('\n')}`
        throw err
      }
      report.updated.push(collName)
      log(`  ~ collection ${collName} 已更新`)
    }
  }

  // 4.5) 系统服务账号（sidecar 系统级操作凭据）：在 hooks 写入前执行，
  //      避开 hooks 文件变化触发的引擎热重载窗口
  try {
    await ensureServiceAccount(pb, authCollectionName, manifest.root)
    log('  ⚙ 系统服务账号就绪（impersonate token 已缓存）')
  } catch (err: any) {
    log(`  ⚠ 服务账号不可用（sidecar 系统级操作将受限）：${err?.message ?? err}`)
  }

  // 5) hooks 编译（默认 <项目根>/pb_hooks —— 与 `oneshot engine up` 的 --hooksDir 一致）
  const hooksDir = opts.hooksDir ?? resolvePath(manifest.root, 'pb_hooks')
  const sidecarUrl = (process.env.ONESHOT_SIDECAR_URL
    || envBlock?.sidecarUrl
    || (manifest.config as any).sidecarUrl
    || 'http://127.0.0.1:7860').replace(/\/$/, '')
  const sidecarToken = getOrCreateSidecarToken(manifest.root)

  // 上一次发布快照（hooks 过期清理与 prune 的所有权依据）；project 名先转义再进 filter 串
  const escapedProject = config.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const prevMeta = await pb.listRecords(
    META_COLLECTION, `?filter=${encodeURIComponent(`project = "${escapedProject}"`)}&perPage=1`,
  )
  const prevSnapshot = prevMeta.items[0]?.snapshot
  const prevServiceNames: string[] = prevSnapshot?.services?.map((s: any) => s.name) ?? []
  const currentServiceNames = config.services.map((s) => s.name)

  // auth 字段默认值：独立注入钩子（不进业务服务的作用域）
  const authDefaults: Record<string, unknown> = {}
  for (const [f, spec] of Object.entries(config.auth?.fields ?? {})) {
    if (spec.options.default !== undefined) authDefaults[f] = spec.options.default
  }
  if (Object.keys(authDefaults).length) {
    const authEntry = buildAuthDefaultsEntry(authCollectionName, authDefaults)
    const authEntryPath = resolvePath(hooksDir, `${authCollectionName}.defaults.pb.js`)
    await writeFile(authEntryPath, authEntry, 'utf8')
    report.hooksFiles.push(authEntryPath)
    log(`  ⚙ auth 默认值注入：${authCollectionName}（${Object.keys(authDefaults).join(', ')}）`)
  }

  for (const svc of config.services) {
    const result = await compileServiceHooks(manifest, svc, hooksDir, { sidecarUrl, sidecarToken })
    if (result) {
      report.hooksFiles.push(...result.files)
      log(`  ⚙ hooks 编译完成：${svc.name}（${result.files.length} 个文件）`)
    }
  }
  const staleHooks = await pruneStaleHooks(hooksDir, prevServiceNames.filter((n) => !currentServiceNames.includes(n)))
  for (const file of staleHooks) log(`  - 清理过期 hooks：${file.split('/').pop()}`)

  // 6) 种子数据：幂等灌入（__key 查重，存在跳过；超管身份插入 —— JSVM 钩子照常生效）
  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      for (const seed of def.seeds ?? []) {
        const { __key, ...fields } = seed as Record<string, any>
        const keyValue = fields[__key]
        if (keyValue === undefined) {
          throw new Error(`seeds 配置错误：${collName} 的种子缺少 ${__key} 字段值`)
        }
        const existing = await pb.listRecords(
          collName, `?filter=${encodeURIComponent(`${__key} = "${String(keyValue).replace(/"/g, '\\"')}"`)}&perPage=1`,
        )
        if (existing.totalItems > 0) continue

        // relation 字段的 { __collection, __filter } 查找解析
        const body: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(fields)) {
          if (v !== null && typeof v === 'object' && !Array.isArray(v) && '__collection' in (v as any)) {
            const lookup = v as { __collection: string; __filter: string }
            const found = await pb.listRecords(
              lookup.__collection, `?filter=${encodeURIComponent(lookup.__filter)}&perPage=1`,
            )
            if (found.totalItems === 0) {
              throw new Error(`种子 ${collName}.${String(keyValue)} 的 relation 字段 ${k} 查无记录：${lookup.__collection} 过滤 ${lookup.__filter}`)
            }
            body[k] = found.items[0].id
          } else {
            body[k] = v
          }
        }
        await pb.createRecord(collName, body)
        report.seeded.push(`${collName}:${String(keyValue)}`)
        log(`  🌱 种子已灌入：${collName} · ${__key}=${String(keyValue)}`)
      }
    }
  }

  // 7) 快照写入 oneshot_meta（供控制台/CLI 读取）
  const snapshot = buildSnapshot(config)
  const hash = snapshotHash(snapshot)
  report.snapshotHash = hash
  if (opts.prune && prevSnapshot?.services) {
    const wanted = new Set(config.services.flatMap((s: any) => Object.keys(s.collections ?? {})))
    const prevNames: string[] = prevSnapshot.services.flatMap((s: any) => s.collections.map((c: any) => c.name))
    for (const name of prevNames) {
      if (wanted.has(name)) continue
      const coll = existing.get(name)
      if (!coll || coll.system || name === authCollectionName || name === META_COLLECTION) continue
      await pb.deleteCollection(coll.id)
      report.pruned.push(name)
      log(`  - collection ${name} 已删除（--prune）`)
    }
  }

  const metaBody = { project: config.name, snapshot: { ...snapshot, hash, publishedAt: report.publishedAt } }
  if (prevMeta.items[0]) {
    await pb.updateRecord(META_COLLECTION, prevMeta.items[0].id, metaBody)
  } else {
    await pb.createRecord(META_COLLECTION, metaBody)
  }

  // 7) 客户端代码生成
  if (opts.gen !== false) {
    const dirs = await generateClients(config, manifest.root)
    report.clientsDirs = dirs
    for (const dir of dirs) log(`  📦 客户端已生成：${dir}`)
  }

  return report
}

interface DesiredCollection {
  type: 'base' | 'auth'
  fields: PbField[]
  indexes?: string[]
  listRule?: string | null
  viewRule?: string | null
  createRule?: string | null
  updateRule?: string | null
  deleteRule?: string | null
  relationCount?: number
}

function buildDesiredCollection(
  name: string,
  def: CollectionDef,
  authCollectionName: string,
  collectionIdOf: (n: string) => string | undefined,
  withRelations: boolean,
  withRules: boolean,
): DesiredCollection {
  const { plain, relations, defaults } = buildFields(def, collectionIdOf)
  void defaults
  const fields = withRelations ? [...plain, ...relations] : plain
  const ownerField = findOwnerField(def, authCollectionName)
  return {
    type: 'base',
    fields,
    indexes: withRules && def.indexes?.length ? def.indexes : undefined,
    ...(withRules ? resolveRules(def.rules, ownerField) : {}),
    relationCount: relations.length,
  }
}
