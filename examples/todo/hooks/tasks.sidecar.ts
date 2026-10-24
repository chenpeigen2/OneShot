// runtime: 'sidecar' 的 handler —— 跑在真正的 Node 进程（由 oneshot dev / oneshot console 启动）。
// 可用 npm 包、Node API、异步逻辑。数据通过 ctx.pbUrl + ctx.token 回调 PB REST API
// （token 转发自原始请求，用户身份与 collection 规则原样生效）。
//
// ctx: { service, action, auth: {id}|null, token, pbUrl, query, body }
// 返回值 → 200 JSON；throw Error（可带 .status）→ 该状态码 + message。
import { createHash } from 'node:crypto'

export async function summary(ctx: any) {
  const res = await fetch(`${ctx.pbUrl}/api/collections/tasks/records?perPage=200`, {
    headers: ctx.token ? { Authorization: ctx.token } : {},
  })
  if (!res.ok) throw Object.assign(new Error(`PB API ${res.status}`), { status: 502 })
  const data: any = await res.json()
  const items: any[] = data.items ?? []
  return {
    total: data.totalItems,
    done: items.filter((t) => t.done).length,
    digest: createHash('sha1').update(items.map((t) => t.id).join(',')).digest('hex').slice(0, 8),
    runtime: `node ${process.version}`,
  }
}
