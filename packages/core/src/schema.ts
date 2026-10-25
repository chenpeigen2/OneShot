/**
 * OneShot 服务定义 DSL。
 *
 * 一个 OneshotConfig 通过 `oneshot publish` 发布到一个 PocketBase 实例：
 * - 每个服务（service）是一个可组合的发布单元：若干 collections + 自定义 actions + 生命周期 hooks
 * - collection 字段/规则会转换成 PocketBase 的 collections Admin API 调用
 * - hooks/actions 由 TS 编译成 pb_hooks/*.pb.js，在 PB 的 goja JSVM 内执行
 */

// ---------- 字段 ----------

export type FieldType =
  | 'text' | 'number' | 'bool' | 'email' | 'url' | 'date'
  | 'select' | 'json' | 'file' | 'relation' | 'editor' | 'geoPoint'

export interface FieldOptions {
  required?: boolean
  /** 展示用主字段（PB presentable），text 字段默认第一个为 true */
  presentable?: boolean
  /** text/number */
  min?: number
  max?: number
  /** text */
  pattern?: string
  /** number */
  onlyInt?: boolean
  /** select */
  values?: string[]
  /** select/file/relation：是否多值 */
  multi?: boolean
  /** select/file/relation 多值时的上限 */
  maxSelect?: number
  /** file，字节 */
  maxSize?: number
  /** file */
  mimeTypes?: string[]
  /** file，缩略图尺寸如 "100x100" */
  thumbs?: string[]
  /** relation：目标 collection 名（发布时解析成 collectionId） */
  collection?: string
  /** relation：级联删除 */
  cascade?: boolean
  /** editor */
  convertURLs?: boolean
  /** 创建记录时的默认值（由注入的 JSVM 校验钩子落库） */
  default?: string | number | boolean | string[]
}

export interface FieldSpec {
  kind: FieldType
  options: FieldOptions
}

// 每种字段类型有自己的“主参数”（select 是 values，relation 是目标 collection），
// 其余选项统一放第二个参数。
type BaseOpts = Omit<FieldOptions, 'values' | 'collection'>

const f = (kind: FieldType) => (options: BaseOpts = {}): FieldSpec => ({ kind, options })

export const s = {
  text: f('text'),
  number: f('number'),
  bool: f('bool'),
  email: f('email'),
  url: f('url'),
  date: f('date'),
  json: f('json'),
  editor: f('editor'),
  geoPoint: f('geoPoint'),
  file: f('file'),
  /** s.select(['a','b'], { multi: true }) */
  select: (values: string[], options: BaseOpts = {}): FieldSpec => ({ kind: 'select', options: { ...options, values } }),
  /** s.relation('users', { required: true }) */
  relation: (collection: string, options: BaseOpts = {}): FieldSpec => ({ kind: 'relation', options: { ...options, collection } }),
}

// ---------- 规则 ----------

/**
 * 访问规则：
 * - 'public'        所有人（空 filter）
 * - 'authenticated' 已登录（@request.auth.id != ""）
 * - 'owner'         记录属主：需要一个指向 auth collection 的 relation 字段（默认找名为 owner 的）
 * - 'superuser'     仅超管（null，PB 默认）
 * - 其他字符串       原样透传为 PB filter 表达式
 */
export type RuleSpec = 'public' | 'authenticated' | 'owner' | 'superuser' | 'admin' | (string & {})

export interface RulesSpec {
  list?: RuleSpec
  view?: RuleSpec
  create?: RuleSpec
  update?: RuleSpec
  delete?: RuleSpec
}

// ---------- 服务 ----------

export interface CollectionDef {
  fields: Record<string, FieldSpec>
  /** 原生 PB index 语句，如 CREATE INDEX idx_tasks_owner ON tasks (owner) */
  indexes?: string[]
  rules?: RulesSpec
  /**
   * 本 collection 专属的 hooks 文件（生命周期导出只对这个 collection 生效）。
   * 服务级 hooks（ServiceDef.hooks）则对所有 collection 生效 —— 按意图选择层级。
   */
  hooks?: string
  /**
   * 种子数据：publish 时幂等灌入（演示/起步数据，简化开发）。
   * 每条必须带 __key（查重字段名，按其值 filter 查，存在即跳过，不更新）。
   * relation 字段的值可写字面 id，或 { __collection, __filter } 由 publish 查找解析。
   */
  seeds?: SeedRecord[]
}

export type SeedValue =
  | string
  | number
  | boolean
  | string[]
  | { __collection: string; __filter: string }

export interface SeedRecord {
  /** 查重字段名（必须是本 collection 的已定义字段） */
  __key: string
  [field: string]: SeedValue | string
}

export type ActionMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ActionDef {
  method?: ActionMethod
  /** 'public' | 'authenticated' | 'superuser'（owner 需记录上下文，MVP 建议在 handler 内自行校验） */
  rule?: 'public' | 'authenticated' | 'superuser'
  /**
   * handler 执行位置：
   * - 'jsvm'（默认）：PB 内置 goja，无 npm/原生异步，随 PB 单文件部署
   * - 'sidecar'：真正的 Node 进程（全 npm 生态），由 oneshot console/dev 启动的控制服务器承载，
   *   PB 路由通过 $http.send 转发过去
   */
  runtime?: 'jsvm' | 'sidecar'
  /** './hooks/tasks.ts#stats' —— 文件 + 具名导出 */
  handler: string
}

export interface ServiceDef {
  title?: string
  /** collection 名 -> 定义 */
  collections: Record<string, CollectionDef>
  /** 自定义 REST 动作，路由为 /api/oneshot/{service}/{action} */
  actions?: Record<string, ActionDef>
  /** 生命周期 hooks 源文件：export beforeValidate/afterCreate/beforeCreateRequest/... */
  hooks?: string
}

export interface ServiceEntry extends ServiceDef {
  name: string
}

// ---------- 顶层配置 ----------

export interface AuthSpec {
  /** auth collection 名，默认 'users' */
  collection?: string
  /** 注册开放度，默认 'public' */
  signup?: 'public' | 'authenticated' | 'superuser'
}

export interface ClientsSpec {
  /** TypeScript 客户端（依赖 npm 的 pocketbase SDK） */
  ts?: { outDir: string }
  /** Dart/Flutter 客户端（依赖 pub.dev 的 pocketbase SDK） */
  dart?: { outDir: string }
}

export interface EnvironmentSpec {
  baseUrl: string
  sidecarUrl?: string
}

export interface OneshotConfig {
  /** 项目名，也是 oneshot_meta 里区分项目的键 */
  name: string
  /** PocketBase 实例地址，可被 ONESHOT_PB_URL 覆盖 */
  baseUrl?: string
  auth?: AuthSpec
  services: ServiceEntry[]
  clients?: ClientsSpec
  /** sidecar 控制服务器地址（runtime:'sidecar' 的转发目标），可被 ONESHOT_SIDECAR_URL 覆盖 */
  sidecarUrl?: string
  /** 多环境：oneshot publish --env <name> 时取对应块（ONESHOT_PB_URL 仍可临时覆盖） */
  environments?: Record<string, EnvironmentSpec>
}

export function service(name: string, def: ServiceDef): ServiceEntry {
  return { name, ...def }
}

export function defineConfig(config: OneshotConfig): OneshotConfig {
  return config
}
