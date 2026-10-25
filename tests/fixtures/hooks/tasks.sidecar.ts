// e2e 夹具：sidecar action —— 证明跑在 Node 进程（异步 + Node API + 回调 PB）
export async function summary(ctx: any) {
  const res = await fetch(`${ctx.pbUrl}/api/collections/tasks/records?perPage=1`, {
    headers: ctx.token ? { Authorization: ctx.token } : {},
  })
  if (!res.ok) throw Object.assign(new Error(`PB API ${res.status}`), { status: 502 })
  const data: any = await res.json()
  return {
    total: data.totalItems,
    runtime: `node ${process.version}`,
    marker: 'from-sidecar',
  }
}
