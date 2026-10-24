import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { OneshotConfig, ServiceEntry } from './schema.js'
import { FIELD_KINDS } from './pb-mapping.js'

export interface ResolvedManifest {
  config: OneshotConfig
  /** manifest 所在目录（项目根），hooks 相对路径基于它解析 */
  root: string
  path: string
}

export class ManifestError extends Error {}

function fail(msg: string): never {
  throw new ManifestError(msg)
}

/** 校验配置对象（控制台写回前也会调用）；不合法抛 ManifestError */
export function validateConfig(config: OneshotConfig, root: string): void {
  if (!config || typeof config !== 'object') fail('manifest 必须导出 defineConfig(...) 的结果作为 default')
  if (!config.name) fail('缺少 name')
  if (!Array.isArray(config.services) || config.services.length === 0) fail('至少需要一个 service')
  if (config.baseUrl && !/^https?:\/\//.test(config.baseUrl)) fail(`baseUrl 必须以 http(s) 开头：${config.baseUrl}`)

  const seenServices = new Set<string>()
  for (const svc of config.services) {
    if (!svc.name) fail('service 缺少 name')
    if (seenServices.has(svc.name)) fail(`service 重名：${svc.name}`)
    seenServices.add(svc.name)

    const collections = Object.entries(svc.collections ?? {})
    if (collections.length === 0) fail(`service "${svc.name}" 至少要定义一个 collection`)

    const seenCollections = new Set<string>()
    for (const [collName, def] of collections) {
      if (seenCollections.has(collName)) fail(`collection 重名：${collName}（跨服务共享 collection 请拆成独立 service）`)
      seenCollections.add(collName)
      if (!/^[a-z][a-z0-9_]*$/.test(collName)) {
        fail(`collection 名 "${collName}" 非法：需以小写字母开头，只含小写字母/数字/下划线`)
      }
      const fields = Object.entries(def.fields ?? {})
      if (fields.length === 0) fail(`collection "${collName}" 没有定义任何字段`)
      for (const [fieldName, spec] of fields) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
          fail(`字段名 "${collName}.${fieldName}" 非法：需以字母开头，只含字母/数字/下划线（PB 同规则）`)
        }
        if (!FIELD_KINDS.includes(spec.kind)) {
          fail(`未知字段类型 "${spec.kind}"（${collName}.${fieldName}），可用：${FIELD_KINDS.join(', ')}`)
        }
        if (spec.kind === 'select' && !spec.options.values?.length) {
          fail(`select 字段 ${collName}.${fieldName} 必须提供 values`)
        }
        if (spec.kind === 'relation' && !spec.options.collection) {
          fail(`relation 字段 ${collName}.${fieldName} 必须指定 collection（目标 collection 名）`)
        }
        if (spec.kind === 'relation' && spec.options.collection === collName) {
          fail(`relation 字段 ${collName}.${fieldName} 暂不支持自引用（PB 需要目标 collectionId 已存在）`)
        }
      }
    }

    for (const [actionName, action] of Object.entries(svc.actions ?? {})) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(actionName)) fail(`action 名 "${actionName}" 非法`)
      if (!action.handler) fail(`action "${svc.name}.${actionName}" 缺少 handler（形如 './hooks/tasks.ts#stats'）`)
      resolveAction(svc, actionName, root)
    }

    for (const [collName, def] of collections) {
      if (def.hooks) {
        const abs = resolve(root, def.hooks)
        if (!existsSync(abs)) fail(`找不到 ${svc.name}.${collName} 的 hooks 文件：${abs}`)
      }
    }

    if (svc.hooks) resolveAction(svc, '__hooks__', root)
  }

  // relation 目标存在性（auth collection 或本项目内其他 collection）
  const known = new Set<string>([config.auth?.collection ?? 'users'])
  for (const svc of config.services) for (const c of Object.keys(svc.collections)) known.add(c)
  for (const svc of config.services) {
    for (const [collName, def] of Object.entries(svc.collections)) {
      for (const [fieldName, spec] of Object.entries(def.fields ?? {})) {
        if (spec.kind === 'relation' && !known.has(spec.options.collection!)) {
          fail(`relation 字段 ${collName}.${fieldName} 指向未定义的 collection "${spec.options.collection}"`)
        }
      }
    }
  }
}

function resolveAction(svc: ServiceEntry, actionName: string, root: string): { file: string; exportName?: string } {
  const raw = actionName === '__hooks__' ? svc.hooks! : svc.actions![actionName].handler
  const [filePart, exportName] = raw.split('#')
  const abs = resolve(root, filePart)
  if (!existsSync(abs)) fail(`找不到 ${svc.name} 的 hooks/handler 文件：${abs}`)
  return { file: abs, exportName }
}

export function resolveHandler(svc: ServiceEntry, actionName: string, root: string): { file: string; exportName?: string } {
  return resolveAction(svc, actionName, root)
}

export async function loadManifest(configPath: string): Promise<ResolvedManifest> {
  const abs = resolve(configPath)
  if (!existsSync(abs)) fail(`找不到 manifest：${abs}`)
  if (!/\.(ts|mts|mjs|js)$/.test(abs)) fail('manifest 必须是 .ts/.mts/.mjs/.js 文件')

  // Node 原生 type stripping 直接加载 TS 配置（要求 erasable TS：不用 enum/namespace）
  let mod: { default?: OneshotConfig }
  try {
    mod = await import(`${pathToFileURL(abs).href}?t=${Date.now()}`)
  } catch (err: any) {
    const code = err?.code ?? ''
    const msg = String(err?.message ?? err)
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_RESOLVE' || msg.includes('Cannot find package')) {
      fail(`加载 manifest 失败：${msg}\n  提示：manifest 依赖 @oneshot/core，请在项目目录安装：pnpm add @oneshot/core（或 npm i @oneshot/core）`)
    }
    fail(`加载 manifest 失败：${msg}`)
  }
  const config = mod.default
  if (!config) fail('manifest 必须有 default 导出：export default defineConfig({...})')

  const root = dirname(abs)
  validateConfig(config, root)
  return { config, root, path: abs }
}
