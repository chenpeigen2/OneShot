import type { FieldSpec, OneshotConfig } from './schema.js'

/**
 * 配置对象 -> 可读的 oneshot.config.ts 源码（控制台编辑写回用）。
 * 保真原则：序列化的是加载后的配置对象本身，写回的文件重新加载后必须等价
 * （e2e 有"写回后再次 publish 全部 unchanged"的幂等断言兜底）。
 * 注意：文件里的注释与手工排版会在写回时丢失（.bak 备份上一版）。
 */

const FIELD_KINDS = ['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation', 'editor', 'geoPoint'] as const

const OPTION_ORDER = [
  'required', 'presentable', 'min', 'max', 'pattern', 'onlyInt',
  'values', 'multi', 'maxSelect', 'maxSize', 'mimeTypes', 'thumbs',
  'collection', 'cascade', 'convertURLs', 'default',
] as const

function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function value(v: unknown): string {
  if (typeof v === 'string') return q(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(value).join(', ')}]`
  return JSON.stringify(v ?? null)
}

function serializeOptions(options: Record<string, unknown> | undefined): string {
  if (!options || typeof options !== 'object') return '{}'
  const record = options as Record<string, unknown>
  const parts: string[] = []
  for (const key of OPTION_ORDER) {
    const v = record[key]
    if (v === undefined) continue
    parts.push(`${key}: ${value(v)}`)
  }
  // 用户自定义的未知键也保真（透传字段）
  for (const [key, v] of Object.entries(record)) {
    if ((OPTION_ORDER as readonly string[]).includes(key) || v === undefined) continue
    parts.push(`${key}: ${value(v)}`)
  }
  return `{ ${parts.join(', ')} }`
}

function serializeField(name: string, spec: FieldSpec): string {
  const kind = FIELD_KINDS.includes(spec.kind as any) ? spec.kind : 'text'
  const options = serializeOptions(spec.options as unknown as Record<string, unknown>)
  const args: string[] = []
  if (kind === 'select') args.push(value((spec.options as any)?.values ?? []))
  if (kind === 'relation') args.push(value((spec.options as any)?.collection ?? ''))
  const hasOptions = Object.keys(spec.options ?? {}).some((k) => {
    if (kind === 'select' && k === 'values') return false
    if (kind === 'relation' && k === 'collection') return false
    return (spec.options as any)[k] !== undefined
  })
  if (hasOptions || args.length === 0) args.push(options)
  return `${name}: s.${kind}(${args.join(', ')}),`
}

function serializeRules(rules: Record<string, string | undefined> | undefined): string {
  if (!rules || Object.keys(rules).length === 0) return ''
  const order = ['list', 'view', 'create', 'update', 'delete']
  const parts = order.filter((k) => rules[k] !== undefined).map((k) => `${k}: ${value(rules[k]!)}`)
  if (!parts.length) return ''
  return `\n          rules: { ${parts.join(', ')} },`
}

function serializeIndexes(indexes: string[] | undefined): string {
  if (!indexes?.length) return ''
  return `\n          indexes: [${indexes.map((i) => value(i)).join(', ')}],`
}

function serializeAction(name: string, a: Record<string, any>): string {
  const parts: string[] = []
  if (a.method !== undefined) parts.push(`method: ${value(a.method)}`)
  if (a.rule !== undefined) parts.push(`rule: ${value(a.rule)}`)
  if (a.runtime !== undefined && a.runtime !== 'jsvm') parts.push(`runtime: ${value(a.runtime)}`)
  parts.push(`handler: ${value(a.handler)}`)
  return `        ${name}: { ${parts.join(', ')} },`
}

function serializeService(svc: Record<string, any>): string {
  const lines: string[] = []
  lines.push(`    service(${q(svc.name)}, {`)
  if (svc.title !== undefined) lines.push(`      title: ${value(svc.title)},`)
  lines.push('      collections: {')
  for (const [collName, def] of Object.entries(svc.collections ?? {})) {
    const d = def as Record<string, any>
    lines.push(`        ${collName}: {`)
    lines.push('          fields: {')
    for (const [fieldName, spec] of Object.entries(d.fields ?? {})) {
      lines.push(`            ${serializeField(fieldName, spec as FieldSpec)}`)
    }
    lines.push('          },')
    const rules = serializeRules(d.rules)
    if (rules) lines.push(rules.trimStart())
    const indexes = serializeIndexes(d.indexes)
    if (indexes) lines.push(indexes.trimStart())
    if (d.hooks !== undefined) lines.push(`          hooks: ${value(d.hooks)},`)
    lines.push('        },')
  }
  lines.push('      },')
  const actionNames = Object.keys(svc.actions ?? {})
  if (actionNames.length) {
    lines.push('      actions: {')
    for (const actionName of actionNames) {
      lines.push(serializeAction(actionName, (svc.actions as Record<string, any>)[actionName]))
    }
    lines.push('      },')
  }
  if (svc.hooks !== undefined) lines.push(`      hooks: ${value(svc.hooks)},`)
  lines.push('    }),')
  return lines.join('\n')
}

export function serializeConfig(config: OneshotConfig): string {
  const lines: string[] = []
  lines.push(`// 由 OneShot 控制台写回 —— 编辑请保持 erasable TS（无 enum/namespace）`)
  lines.push(`// 手工注释与排版在控制台写回时不保留；上一版备份为 oneshot.config.ts.bak`)
  lines.push(`import { defineConfig, s, service } from '@oneshot/core'`)
  lines.push('')
  lines.push('export default defineConfig({')
  lines.push(`  name: ${value(config.name)},`)
  if (config.baseUrl !== undefined) lines.push(`  baseUrl: ${value(config.baseUrl)},`)
  if (config.sidecarUrl !== undefined) lines.push(`  sidecarUrl: ${value((config as any).sidecarUrl)},`)
  if (config.auth) {
    const authParts = [`collection: ${value(config.auth.collection ?? 'users')}`]
    if (config.auth.signup !== undefined) authParts.push(`signup: ${value(config.auth.signup)}`)
    lines.push(`  auth: { ${authParts.join(', ')} },`)
  }
  lines.push('')
  lines.push('  services: [')
  for (const svc of config.services as unknown as Record<string, any>[]) {
    lines.push(serializeService(svc))
  }
  lines.push('  ],')
  if (config.environments && Object.keys(config.environments).length) {
    lines.push('  environments: {')
    for (const [envName, env] of Object.entries(config.environments)) {
      const parts = [`baseUrl: ${value(env.baseUrl)}`]
      if (env.sidecarUrl !== undefined) parts.push(`sidecarUrl: ${value(env.sidecarUrl)}`)
      lines.push(`    ${envName}: { ${parts.join(', ')} },`)
    }
    lines.push('  },')
  }
  if (config.clients) {
    const parts: string[] = []
    if (config.clients.ts) parts.push(`ts: { outDir: ${value(config.clients.ts.outDir)} }`)
    if (config.clients.dart) parts.push(`dart: { outDir: ${value(config.clients.dart.outDir)} }`)
    if (parts.length) lines.push(`  clients: { ${parts.join(', ')} },`)
  }
  lines.push('})')
  lines.push('')
  return lines.join('\n')
}
