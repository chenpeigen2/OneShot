import type {
  CollectionDef,
  FieldSpec,
  OneshotConfig,
  RuleSpec,
  RulesSpec,
  ServiceEntry,
} from './schema.js'

export const FIELD_KINDS = [
  'text', 'number', 'bool', 'email', 'url', 'date',
  'select', 'json', 'file', 'relation', 'editor', 'geoPoint',
] as const

// PB 会返回一批 system 字段，diff 时要区分“我们的”与“系统的”
const PB_SYSTEM_FIELD_NAMES = new Set(['id'])

export interface PbField {
  type: string
  name: string
  required?: boolean
  presentable?: boolean
  system?: boolean
  [key: string]: unknown
}

export interface PbCollection {
  id: string
  name: string
  type: 'base' | 'view' | 'auth'
  system?: boolean
  fields: PbField[]
  indexes?: string[]
  listRule: string | null
  viewRule: string | null
  createRule: string | null
  updateRule: string | null
  deleteRule: string | null
  [key: string]: unknown
}

// ---------- 规则解析 ----------

export function findOwnerField(
  def: CollectionDef,
  authCollectionName: string,
): string | undefined {
  const relations = Object.entries(def.fields ?? {}).filter(
    ([, spec]) => spec.kind === 'relation' && spec.options.collection === authCollectionName,
  )
  if (relations.length === 0) return undefined
  return relations.find(([name]) => name === 'owner')?.[0] ?? relations[0][0]
}

export function resolveRule(
  rule: RuleSpec | undefined,
  ownerField: string | undefined,
  action: 'list' | 'view' | 'create' | 'update' | 'delete',
): string | null | undefined {
  if (rule === undefined) return undefined
  if (rule === 'public') return ''
  if (rule === 'authenticated') return '@request.auth.id != ""'
  if (rule === 'owner') {
    if (!ownerField) throw new Error(`规则 "owner" 需要一个指向 auth collection 的 relation 字段`)
    const lhs = action === 'create' ? `@request.body.${ownerField}` : ownerField
    return `@request.auth.id != "" && ${lhs} = @request.auth.id`
  }
  if (rule === 'superuser' || rule === 'admin') return null
  return rule
}

export function resolveRules(
  rules: RulesSpec | undefined,
  ownerField: string | undefined,
): { listRule?: string | null; viewRule?: string | null; createRule?: string | null; updateRule?: string | null; deleteRule?: string | null } {
  const out: Record<string, string | null | undefined> = {}
  for (const key of ['list', 'view', 'create', 'update', 'delete'] as const) {
    const v = resolveRule(rules?.[key], ownerField, key)
    if (v !== undefined) out[`${key}Rule`] = v
  }
  return out as any
}

// ---------- 字段转换 ----------

export function fieldToJson(name: string, spec: FieldSpec, collectionId?: string): PbField {
  const o = spec.options
  const json: PbField = { type: spec.kind, name, required: !!o.required }
  // presentable 对所有字段类型生效（text 之外的类型也能声明展示主字段）
  json.presentable = o.presentable
  switch (spec.kind) {
    case 'text':
      json.min = o.min
      json.max = o.max
      json.pattern = o.pattern
      break
    case 'number':
      json.min = o.min
      json.max = o.max
      json.onlyInt = o.onlyInt
      break
    case 'select': {
      const values = o.values ?? []
      // PB 要求 select 的 maxSelect 不得超过 values 数量
      const cap = Math.max(values.length, 1)
      json.values = values
      json.maxSelect = o.multi ? Math.min(o.maxSelect ?? cap, cap) : 1
      break
    }
    case 'file':
      json.maxSelect = o.maxSelect ?? (o.multi ? 99 : 1)
      json.maxSize = o.maxSize
      json.mimeTypes = o.mimeTypes
      json.thumbs = o.thumbs
      break
    case 'relation':
      json.maxSelect = o.multi ? (o.maxSelect ?? 99) : 1
      json.cascadeDelete = !!o.cascade
      if (collectionId) json.collectionId = collectionId
      break
    case 'json':
      json.maxSize = o.maxSize
      break
    case 'editor':
      json.convertURLs = o.convertURLs
      json.maxSize = o.maxSize
      break
    // email / url / date / bool / geoPoint 无额外选项
  }
  return json
}

/** 用户定义字段 -> PB fields 数组（自动补 created/updated autodate 与 presentable） */
export function buildFields(def: CollectionDef, collectionIdOf: (name: string) => string | undefined): {
  plain: PbField[]
  relations: PbField[]
  defaults: Record<string, unknown>
} {
  const plain: PbField[] = []
  const relations: PbField[] = []
  const defaults: Record<string, unknown> = {}
  let presentableAssigned = false

  for (const [name, spec] of Object.entries(def.fields ?? {})) {
    const o = spec.options
    if (o.default !== undefined) defaults[name] = o.default
    if (spec.kind === 'relation') {
      relations.push(fieldToJson(name, spec, collectionIdOf(o.collection!)))
      continue
    }
    const json = fieldToJson(name, spec)
    if (spec.kind === 'text' && json.presentable === undefined) {
      if (!presentableAssigned) {
        json.presentable = true
        presentableAssigned = true
      } else {
        json.presentable = false
      }
    }
    plain.push(json)
  }

  plain.push(
    { type: 'autodate', name: 'created', onCreate: true },
    { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
  )
  return { plain, relations, defaults }
}

// ---------- auth collection ----------

/** 把我们的字段 upsert 进 PB 返回的现有 fields（保留已有 field id 与手工加的字段，绝不删字段） */
export function mergeFields(existing: PbField[], incoming: PbField[]): PbField[] {
  const out = existing.filter((f) => !f.system || f.name === 'id')
  for (const field of incoming) {
    const idx = out.findIndex((f) => f.name === field.name)
    if (idx >= 0) {
      const prev = out[idx]
      out[idx] = { ...field, id: prev.id, system: field.system ?? prev.system }
    } else {
      out.push(field)
    }
  }
  return out
}

/**
 * 非对称比较：manifest 声明的每个字段必须在现有 collection 中“被满足”。
 * PB 会给字段补一堆默认值（maxSize 等），只比较我们显式声明的键，避免无意义 diff 抖动。
 */
function fieldSatisfied(ours: PbField, existing: PbField | undefined): boolean {
  if (!existing) return false
  if (ours.type !== existing.type) return false
  const wantsRequired = !!ours.required
  if (wantsRequired !== !!existing.required) return false
  for (const [k, v] of Object.entries(ours)) {
    if (k === 'type' || k === 'name' || k === 'required') continue
    // 只跳过未声明的选项；显式的 0/false/'' 必须参与比较（否则 min:0/max:0/maxSize:0 永不触发 diff）
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (JSON.stringify(existing[k]) !== JSON.stringify(v)) return false
  }
  return true
}

export function collectionSatisfied(existing: PbCollection, desired: {
  fields: PbField[]
  indexes?: string[]
  listRule?: string | null
  viewRule?: string | null
  createRule?: string | null
  updateRule?: string | null
  deleteRule?: string | null
}): boolean {
  const existingByName = new Map(existing.fields.map((f) => [f.name, f]))
  for (const ours of desired.fields) {
    if (PB_SYSTEM_FIELD_NAMES.has(ours.name)) continue
    if (!fieldSatisfied(ours, existingByName.get(ours.name))) return false
  }
  const rulesEqual = (['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'] as const)
    .every((k) => (existing[k] ?? null) === (desired[k] ?? null))
  // 索引只在 manifest 声明了的情况下才同步/比较（避免清掉控制台手工加的索引、避免与 PB 内置索引打架）
  const idxEqual = desired.indexes === undefined
    || JSON.stringify([...(existing.indexes ?? [])].sort())
      === JSON.stringify([...(desired.indexes ?? [])].sort())
  return rulesEqual && idxEqual
}

// ---------- auth collection ----------

/**
 * 框架内置的系统服务账号（sidecar 用它执行业务级写操作）。
 * auth 的托管字段规则默认放行它 —— 否则 sidecar 无法更新欠款/角色等受管字段。
 */
export const SERVICE_ACCOUNT_EMAIL = 'oneshot-service@system.local'

/** 把默认值渲染成 PB filter 字面量（字符串加引号，数字/布尔原样） */
function pbLiteral(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/**
 * 托管字段的"注册锁"：客户端可以省略该字段（服务端注入默认值），
 * 也可以显式提交默认值；提交其他值一律拒绝（不能靠注册提权）。
 *
 * 例（role 默认 reader）：(@request.body.role = "" || @request.body.role = "reader")
 */
export function managedCreateLock(managed: string[], fields: Record<string, FieldSpec> = {}): string {
  return managed.map((field) => {
    const def = fields[field]?.options?.default
    return def === undefined
      ? `(@request.body.${field} = "")`
      : `(@request.body.${field} = "" || @request.body.${field} = ${pbLiteral(def)})`
  }).join(' && ')
}

/**
 * 托管字段的"自助更新锁"：只能省略，或保持与库中现值一致。
 * 裸字段名在 update 规则里指该记录当前存储值（PB 语义）。
 *
 * 例：(@request.body.fines = "" || @request.body.fines = fines)
 */
export function managedUpdateLock(managed: string[]): string {
  return managed.map((field) => `(@request.body.${field} = "" || @request.body.${field} = ${field})`).join(' && ')
}

export function buildAuthCollectionCreate(
  name: string,
  signup: 'public' | 'authenticated' | 'superuser',
  customFields: Record<string, FieldSpec> = {},
  rules: { listRule?: string | null; viewRule?: string | null; createRule?: string | null; updateRule?: string | null; managed?: string[] } = {},
): Record<string, unknown> {
  const managed = rules.managed ?? []
  const signupBase = signup === 'public' ? '' : signup === 'authenticated' ? '@request.auth.id != ""' : null
  // 注册：公开注册 + 托管字段锁（客户端可省略托管字段，但不能改成非默认值）
  const generatedCreate = signupBase === null
    ? null
    : [signupBase, managedCreateLock(managed, customFields)].filter(Boolean).join(' && ')
  // 自助更新：仅本人可改，托管字段只能省略或保持现值；被封禁者不可改；
  // 系统服务账号旁路（sidecar 执行业务级写：改角色、记罚款、收款）
  const selfBranch = ['id = @request.auth.id']
  if (managed.includes('blocked')) selfBranch.push('blocked != true')
  selfBranch.push(managedUpdateLock(managed))
  const generatedUpdate = managed.length
    ? `@request.auth.email = ${JSON.stringify(SERVICE_ACCOUNT_EMAIL)} || (${selfBranch.join(' && ')})`
    : '@request.auth.id != "" && id = @request.auth.id'
  const createRule = rules.createRule !== undefined ? rules.createRule : generatedCreate
  const updateRule = rules.updateRule !== undefined ? rules.updateRule : generatedUpdate
  // 自定义字段合并（系统字段 name/avatar 之后）；password/email 等由 PB 系统管理，禁止覆盖
  const systemOnly = new Set(['id', 'password', 'tokenKey', 'email', 'emailVisibility', 'verified'])
  const extra = Object.entries(customFields)
    .filter(([fieldName]) => !systemOnly.has(fieldName))
    .map(([fieldName, spec]) => fieldToJson(fieldName, spec))
  return {
    name,
    type: 'auth',
    fields: [
      { type: 'text', name: 'name', presentable: true },
      { type: 'file', name: 'avatar', maxSelect: 1, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
      ...extra,
    ],
    listRule: rules.listRule !== undefined ? rules.listRule : '@request.auth.id != "" && id = @request.auth.id',
    viewRule: rules.viewRule !== undefined ? rules.viewRule : '@request.auth.id != "" && id = @request.auth.id',
    createRule,
    updateRule,
    deleteRule: null,
    passwordAuth: { enabled: true, identityFields: ['email'] },
  }
}

// ---------- 快照（发布状态） ----------

export interface ServiceSnapshot {
  name: string
  title?: string
  collections: { name: string; fields: string[]; rules: RulesSpec }[]
      actions: { name: string; method: string; route: string; runtime: string }[]
  hasHooks: boolean
}

export function buildSnapshot(config: OneshotConfig): { services: ServiceSnapshot[] } {
  return {
    services: config.services.map((svc) => ({
      name: svc.name,
      title: svc.title,
      collections: Object.entries(svc.collections).map(([name, def]) => ({
        name,
        fields: Object.keys(def.fields ?? {}),
        rules: def.rules ?? {},
      })),
      actions: Object.entries(svc.actions ?? {}).map(([name, a]) => ({
        name,
        method: a.method ?? 'POST',
        route: `/api/oneshot/${svc.name}/${name}`,
        runtime: a.runtime ?? 'jsvm',
      })),
      hasHooks: !!svc.hooks || Object.keys(svc.actions ?? {}).length > 0,
    })),
  }
}

export function snapshotHash(snapshot: unknown): string {
  const str = JSON.stringify(snapshot)
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}
