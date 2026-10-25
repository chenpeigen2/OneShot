import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import type { ServiceEntry } from './schema.js'
import type { ResolvedManifest } from './manifest.js'

const LIFECYCLE_HOOKS: { pbHook: string; exportName: string }[] = [
  { pbHook: 'onRecordValidate', exportName: 'beforeValidate' },
  { pbHook: 'onRecordCreateRequest', exportName: 'beforeCreateRequest' },
  { pbHook: 'onRecordAfterCreateSuccess', exportName: 'afterCreate' },
  { pbHook: 'onRecordUpdateRequest', exportName: 'beforeUpdateRequest' },
  { pbHook: 'onRecordAfterUpdateSuccess', exportName: 'afterUpdate' },
  { pbHook: 'onRecordDeleteRequest', exportName: 'beforeDelete' },
  { pbHook: 'onRecordAfterDeleteSuccess', exportName: 'afterDelete' },
]

function middlewareForRule(rule: string | undefined): string {
  if (!rule || rule === 'public') return ''
  if (rule === 'authenticated') return ', $apis.requireAuth()'
  if (rule === 'superuser') return ', $apis.requireSuperuserAuth()'
  throw new Error(`action 规则只支持 public/authenticated/superuser，收到：${rule}（owner 级校验请在 handler 内用 ctx.auth 自行处理）`)
}

interface HookGroup {
  /** 该组打包进的用户模块文件 */
  userFiles: string[]
  /** 用户模块输出绝对路径（本机写盘用） */
  moduleAbs: string
  /** 模块文件名（PB 容器内经 __hooks 全局解析，跨部署形态正确） */
  moduleName: string
  /** 注册生命周期钩子时的 collection filter 参数（PB 原生支持） */
  filter: string[]
  /** 该组是否注册生命周期钩子（纯 action 模块不注册） */
  lifecycle: boolean
  /** 服务级模块（承载 action handler）或 collection 级模块 */
  kind: 'service' | 'collection'
}

/**
 * hooks 分组：
 * - 服务级（svc.hooks + jsvm action handler 文件）→ <svc>.user.pb.js，
 *   lifecycle 过滤 = 全部 collections；action 路由从这个模块取 handler
 * - collection 级（CollectionDef.hooks）→ <svc>.<coll>.user.pb.js，
 *   lifecycle 过滤 = 仅该 collection（避免同一服务内跨 collection 串扰）
 */
function buildHookGroups(manifest: ResolvedManifest, svc: ServiceEntry, hooksDir: string): HookGroup[] {
  const collNames = Object.keys(svc.collections)
  const groups: HookGroup[] = []

  // 字段 default 由服务级 beforeValidate 注入：只要任一 collection 声明了 default，
  // 即使没有 svc.hooks / jsvm action 也必须建服务级 lifecycle 组，否则默认值静默丢失。
  const hasDefaults = Object.values(svc.collections).some((def) =>
    Object.values(def.fields ?? {}).some((spec) => spec.options.default !== undefined),
  )

  const jsvmActionFiles = Object.values(svc.actions ?? {})
    .filter((a) => a.runtime !== 'sidecar')
    .map((a) => a.handler.split('#')[0])
  const serviceFiles = [...new Set([...(svc.hooks ? [svc.hooks] : []), ...jsvmActionFiles])]
  if (serviceFiles.length || hasDefaults) {
    groups.push({
      userFiles: serviceFiles.map((rel) => resolve(manifest.root, rel)),
      moduleAbs: resolve(hooksDir, `${svc.name}.user.pb.js`).split('\\').join('/'),
      moduleName: `${svc.name}.user.pb.js`,
      filter: collNames,
      lifecycle: !!svc.hooks || hasDefaults,
      kind: 'service',
    })
  }

  for (const [collName, def] of Object.entries(svc.collections)) {
    if (!def.hooks) continue
    groups.push({
      userFiles: [resolve(manifest.root, def.hooks)],
      moduleAbs: resolve(hooksDir, `${svc.name}.${collName}.user.pb.js`).split('\\').join('/'),
      moduleName: `${svc.name}.${collName}.user.pb.js`,
      filter: [collName],
      lifecycle: true,
      kind: 'collection',
    })
  }
  return groups
}

async function buildEntrySource(
  svc: ServiceEntry,
  defaults: Record<string, Record<string, unknown>>,
  groups: HookGroup[],
  sidecar: { url: string; token: string },
): Promise<string> {
  const lines: string[] = []

  // ⚠️ PB JSVM 文档约束：hook handler 在隔离上下文中执行，模块顶层绑定在 handler 内不可见，
  // 共享代码必须走 .user.pb.js 模块 + handler 内 require。
  // require 路径必须用 __hooks 全局拼接（PB 容器内 hooks 目录随部署形态变化，
  // 烘焙宿主机绝对路径在 docker 部署下指向不存在的路径）。
  // 另：requestInfo().body 里 json 类型字段的值会被 PB 回填为原始字节（[]byte），__normBody
  // 只把「顶层、全为 0-255 数字的数组」还原成解析后的 JSON，其余值原样透传（深遍历 Go 绑定对象会炸）。
  lines.push(`// 由 oneshot publish 生成，请勿手改（源码见 manifest 中的 hooks/handler 文件）`)
  lines.push(`
function __normBody(raw) {
  var out = {}
  for (var k in raw) {
    var v = raw[k]
    if (v && typeof v === 'object' && typeof v.length === 'number' && v.length > 0 && typeof v[0] === 'number') {
      var allBytes = true
      for (var i = 0; i < v.length; i++) {
        var x = v[i]
        if (typeof x !== 'number' || x < 0 || x > 255) { allBytes = false; break }
      }
      if (allBytes) {
        try { out[k] = JSON.parse(String.fromCharCode.apply(null, v)); continue } catch (err) {}
      }
    }
    out[k] = v
  }
  return out
}`)

  for (const group of groups) {
    if (!group.lifecycle) continue
    for (const { pbHook, exportName } of LIFECYCLE_HOOKS) {
      const isValidate = exportName === 'beforeValidate'
      // 注意：不用 onRecordXxx(fn, "coll") 的 filter 参数 —— v0.40 JSVM 对 record 级钩子
      // 静默不注册 filter。scope 判断在 handler 内做（实测可靠的唯一方式）。
      lines.push(`
${pbHook}(function (e) {
  var coll = e.record.collection().name
  if (${JSON.stringify(group.filter)}.indexOf(coll) === -1) { e.next(); return }
  ${isValidate ? `
  var d = ${JSON.stringify(defaults)}[coll]
  // 只在创建时回填默认值：update 时用户显式清空的字段不能被默认值悄悄盖回去
  if (d && e.record.isNew()) {
    for (var k in d) {
      var v = e.record.get(k)
      if (v === '' || v === undefined || v === null) e.record.set(k, d[k])
    }
  }` : ''}
  var u = require(__hooks + ${JSON.stringify('/' + group.moduleName)})
  var fn = u[${JSON.stringify(exportName)}]
  if (fn) {
    var info = null
    try { info = e.requestInfo() } catch (err) {}
    fn({
      e: e, app: e.app, record: e.record, auth: e.auth, coll: coll,
      query: info ? info.query : {}, body: info ? __normBody(info.body) : {},
      http: function (opts) { return $http.send(opts) },
      log: function (msg) { console.log('[oneshot:${svc.name}] ' + msg) },
    })
  }
  e.next()
})`)
    }
  }

  // jsvm action 路由：从服务级用户模块取 handler
  const serviceModuleName = groups.find((g) => g.kind === 'service')?.moduleName
  for (const [actionName, action] of Object.entries(svc.actions ?? {})) {
    const method = action.method ?? 'POST'
    const route = `/api/oneshot/${svc.name}/${actionName}`
    const exportName = action.handler.split('#')[1] ?? actionName

    if (action.runtime === 'sidecar') {
      lines.push(`
routerAdd(${JSON.stringify(method)}, ${JSON.stringify(route)}, function (e) {
  var info = e.requestInfo()
  var payload = {
    service: ${JSON.stringify(svc.name)},
    action: ${JSON.stringify(actionName)},
    auth: e.auth ? { id: e.auth.id } : null,
    token: e.auth ? e.requestInfo().headers.authorization : '',
    query: info.query, body: info.body,
  }
  try {
    var res = $http.send({
      url: ${JSON.stringify(`${sidecar.url}/sidecar/${svc.name}/${actionName}`)},
      method: ${JSON.stringify(method)},
      headers: { 'Content-Type': 'application/json', Authorization: ${JSON.stringify(`Bearer ${sidecar.token}`)} },
      body: JSON.stringify(payload),
      timeout: 30,
    })
    e.json(res.statusCode || 502, res.json !== undefined ? res.json : res.body)
  } catch (err) {
    e.json(502, { error: 'sidecar unreachable: ' + err })
  }
}${middlewareForRule(action.rule)})`)
      continue
    }

    lines.push(`
routerAdd(${JSON.stringify(method)}, ${JSON.stringify(route)}, function (e) {
  var u = require(__hooks + ${JSON.stringify('/' + serviceModuleName)})
  var info = e.requestInfo()
  var out = u[${JSON.stringify(exportName)}]({
    e: e, app: e.app, auth: e.auth,
    query: info.query, body: info.body,
    http: function (opts) { return $http.send(opts) },
    log: function (msg) { console.log('[oneshot:${svc.name}:${actionName}] ' + msg) },
  })
  e.json(200, out === undefined ? {} : out)
}${middlewareForRule(action.rule)})`)
  }

  return lines.join('\n')
}

export interface HooksCompileOptions {
  sidecarUrl?: string
  sidecarToken?: string
}

export interface HooksCompileResult {
  service: string
  files: string[]
}

/**
 * 编译服务的全部 hooks 产物（用户模块 + 注册入口）。
 * 用户源码保持 TS/ESM，esbuild 在这里按组打包成 goja 可执行的 CommonJS。
 */
export async function compileServiceHooks(
  manifest: ResolvedManifest,
  svc: ServiceEntry,
  hooksDir: string,
  opts: HooksCompileOptions = {},
): Promise<HooksCompileResult | null> {
  const groups = buildHookGroups(manifest, svc, hooksDir)
  if (groups.length === 0) return null

  const defaults: Record<string, Record<string, unknown>> = {}
  for (const [coll, def] of Object.entries(svc.collections)) {
    for (const [fieldName, spec] of Object.entries(def.fields ?? {})) {
      if (spec.options.default !== undefined) {
        ;(defaults[coll] ??= {})[fieldName] = spec.options.default
      }
    }
  }

  await mkdir(hooksDir, { recursive: true })
  const files: string[] = []

  for (const group of groups) {
    // typeof module 守卫：.user.pb.js 会被 PB 当 hook 文件自动加载（该上下文没有 module 全局），
    // 守卫避免自动加载报错刷日志；真正的加载发生在 handler 内的 require（CJS 上下文，module 可用）。
    // userFiles 为空（纯 defaults 注入组）时产物为空导出模块，不能走 Object.assign({}, '{}') 的字符串误分支。
    const reexportRequires = group.userFiles.map((f) => `require(${JSON.stringify(f.split('\\').join('/'))})`).join(', ')
    const moduleContents = reexportRequires
      ? `if (typeof module !== "undefined") { module.exports = Object.assign({}, ${reexportRequires}) }`
      : `if (typeof module !== "undefined") { module.exports = {} }`
    await build({
      stdin: {
        contents: moduleContents,
        resolveDir: manifest.root,
        sourcefile: `${svc.name}--user-module.ts`,
        loader: 'ts',
      },
      bundle: true,
      format: 'cjs',
      platform: 'neutral',
      target: 'es2020',
      outfile: group.moduleAbs,
      legalComments: 'none',
      logLevel: 'silent',
    })
    files.push(group.moduleAbs)
  }

  const entry = await buildEntrySource(svc, defaults, groups, {
    url: (opts.sidecarUrl ?? 'http://127.0.0.1:7860').replace(/\/$/, ''),
    token: opts.sidecarToken ?? '',
  })
  const outfile = resolve(hooksDir, `${svc.name}.pb.js`)
  await writeFile(outfile, entry, 'utf8')
  files.push(outfile)

  return { service: svc.name, files }
}

/**
 * 清理指定的过期 hooks 产物（.pb.js 与配套 .user.pb.js）。
 * 只清理由调用方认定的过期服务（本项目上一次快照里有、本次 manifest 没有），
 * 不做目录扫描 —— 多项目共享 hooks 目录时不能误删别的项目的产物。
 */
export async function pruneStaleHooks(hooksDir: string, staleServices: string[]): Promise<string[]> {
  if (staleServices.length === 0) return []
  let names: string[]
  try {
    names = await readdir(hooksDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    const base = name.replace(/\.user\.pb\.js$/, '').replace(/\.pb\.js$/, '')
    if (base === name) continue
    const owned = staleServices.some((svc) => base === svc || base.startsWith(`${svc}.`))
    if (owned) {
      await rm(resolve(hooksDir, name))
      removed.push(resolve(hooksDir, name))
    }
  }
  return removed
}
