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
  if (config.name && /["\\]/.test(config.name)) fail(`name 不能包含引号或反斜杠：${config.name}`)
  if (config.environments) {
    for (const envName of Object.keys(config.environments)) {
      // 环境键会以标识符形式写回 oneshot.config.ts（--env <key> 引用），必须合法
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(envName)) {
        fail(`环境键名 "${envName}" 非法：需以字母/_/$ 开头，只含字母/数字/_/$`)
      }
      // 对象字面量里 __proto__/constructor/prototype 会变成设原型而非键值对，写回后键静默消失
      if (['__proto__', 'constructor', 'prototype'].includes(envName)) {
        fail(`环境键名 "${envName}" 是保留字，不可用`)
      }
      if (envName.length > 64) fail(`环境键名 "${envName.slice(0, 16)}…" 超长（>64 字符）`)
    }
  }
  if (!Array.isArray(config.services) || config.services.length === 0) fail('至少需要一个 service')
  if (config.baseUrl && !/^https?:\/\//.test(config.baseUrl)) fail(`baseUrl 必须以 http(s) 开头：${config.baseUrl}`)
  if (config.auth?.fields) {
    const systemOnly = new Set(['id', 'password', 'tokenKey', 'email', 'emailVisibility', 'verified'])
    for (const [fieldName, spec] of Object.entries(config.auth.fields)) {
      if (systemOnly.has(fieldName)) fail(`auth 字段 "${fieldName}" 是系统字段，不可自定义`)
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
        fail(`auth 字段名 "${fieldName}" 非法：需以字母开头，只含字母/数字/下划线`)
      }
      if (!FIELD_KINDS.includes(spec.kind)) fail(`auth 字段 "${fieldName}" 未知类型 "${spec.kind}"`)
      if (spec.kind === 'select' && !spec.options.values?.length) fail(`auth select 字段 ${fieldName} 必须提供 values`)
    }
  }
  if (config.auth?.managed) {
    const managed = config.auth.managed
    if (!Array.isArray(managed) || managed.some((f) => typeof f !== 'string')) {
      fail('auth.managed 必须是字符串数组（托管字段名）')
    }
    const known = new Set(Object.keys(config.auth?.fields ?? {}))
    for (const fieldName of managed) {
      if (!known.has(fieldName)) {
        fail(`auth.managed 引用了未定义的字段 "${fieldName}"（需在 auth.fields 中声明）`)
      }
      const spec = config.auth!.fields![fieldName]
      if (spec.options.default === undefined) {
        fail(`auth.managed 字段 "${fieldName}" 必须声明 default（托管字段的值由服务端决定）`)
      }
    }
    if (new Set(managed).size !== managed.length) fail('auth.managed 存在重复字段名')
  }

  const seenServices = new Set<string>()
  for (const svc of config.services) {
    if (!svc.name) fail('service 缺少 name')
    // service 名会拼进 hooks 产物文件名与 action 路由（<svc>.pb.js、/api/oneshot/<svc>/<action>），必须收紧
    if (!/^[a-z][a-z0-9_]*$/.test(svc.name)) {
      fail(`service 名 "${svc.name}" 非法：需以小写字母开头，只含小写字母/数字/下划线`)
    }
    // 产物文件名 = <svc>.<coll>.user.pb.js 等，超长名会在写盘时 ENAMETOOLONG 中途炸
    if (svc.name.length > 64) fail(`service 名超长（>64 字符）：${svc.name.slice(0, 16)}…`)
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
        // 单值字段的 maxSelect 不生效（PB 映射只读 multi 分支），显式声明即报错，避免静默忽略
        if ((spec.kind === 'select' || spec.kind === 'relation') && spec.options.maxSelect !== undefined && !spec.options.multi) {
          fail(`字段 ${collName}.${fieldName} 的 maxSelect 只在 multi: true 时生效（单值请去掉 maxSelect，多值请加 multi）`)
        }
        if (spec.kind === 'relation' && !spec.options.collection) {
          fail(`relation 字段 ${collName}.${fieldName} 必须指定 collection（目标 collection 名）`)
        }
        if (spec.kind === 'relation' && spec.options.collection === collName) {
          fail(`relation 字段 ${collName}.${fieldName} 暂不支持自引用（PB 需要目标 collectionId 已存在）`)
        }
      }
    }

    const ACTION_RULES = ['public', 'authenticated', 'superuser']
    const ACTION_RUNTIMES = ['jsvm', 'sidecar']
    const ACTION_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    for (const [actionName, action] of Object.entries(svc.actions ?? {})) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(actionName)) fail(`action 名 "${actionName}" 非法`)
      if (!action.handler) fail(`action "${svc.name}.${actionName}" 缺少 handler（形如 './hooks/tasks.ts#stats'）`)
      // rule/runtime/method 在发布前校验（否则坏值要到 hooks 编译/路由注册中途才炸，collections 已改完）
      if (action.rule !== undefined && !ACTION_RULES.includes(action.rule)) {
        fail(`action "${svc.name}.${actionName}" 的 rule 只支持 ${ACTION_RULES.join('/')}，收到：${action.rule}`)
      }
      if (action.runtime !== undefined && !ACTION_RUNTIMES.includes(action.runtime)) {
        fail(`action "${svc.name}.${actionName}" 的 runtime 只支持 ${ACTION_RUNTIMES.join('/')}，收到：${action.runtime}`)
      }
      if (action.method !== undefined && !ACTION_METHODS.includes(action.method)) {
        fail(`action "${svc.name}.${actionName}" 的 method 只支持 ${ACTION_METHODS.join('/')}，收到：${action.method}`)
      }
      resolveAction(svc, actionName, root)
    }

    for (const [collName, def] of collections) {
      if (def.hooks) {
        const abs = resolve(root, def.hooks)
        if (!existsSync(abs)) fail(`找不到 ${svc.name}.${collName} 的 hooks 文件：${abs}`)
      }
      for (const [i, seed] of (def.seeds ?? []).entries()) {
        const at = `${svc.name}.${collName}.seeds[${i}]`
        if (!seed || typeof seed.__key !== 'string' || !seed.__key) {
          fail(`${at} 缺少 __key（查重字段名，publish 按其值幂等查重）`)
        }
        const fieldNames = Object.keys(def.fields ?? {})
        if (!fieldNames.includes(seed.__key)) {
          fail(`${at}.__key "${seed.__key}" 不是 ${collName} 的已定义字段`)
        }
        if (seed.__key === 'id') fail(`${at}.__key 不能是 id`)
        for (const [k, v] of Object.entries(seed)) {
          if (k === '__key') continue
          if (!fieldNames.includes(k)) fail(`${at} 引用了未定义字段 "${k}"`)
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const lookup = v as any
            if (typeof lookup.__collection !== 'string' || typeof lookup.__filter !== 'string') {
              fail(`${at}.${k} 的 relation 查找对象需同时含 __collection 与 __filter`)
            }
          }
        }
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
