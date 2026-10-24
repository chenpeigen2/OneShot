export const SHOP_HOOKS_ORDERS_SIDECAR = `// runtime: 'sidecar' 的 handler —— 跑在真正的 Node 进程（oneshot dev / oneshot console 启动）。
// ctx: { service, action, auth: {id}|null, token, pbUrl, query, body }
// 数据通过 ctx.pbUrl + ctx.token 回调 PB REST API（用户身份与规则原样生效）。
//
// checkout：权威下单路径 —— 校验商品存在性/库存，计算总价，以当前用户身份创建订单。
// （PB v0.40.6 JSVM 的 record.set 持久化怪癖使跨表写值类逻辑必须走 sidecar，详见 README。）

export async function checkout(ctx: any) {
  const items = Array.isArray(ctx.body?.items) ? ctx.body.items : []
  if (items.length === 0) throw Object.assign(new Error('items 不能为空'), { status: 400 })
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })

  // 公开读：商品信息用当前用户 token 即可获取
  let total = 0
  const normalized = []
  for (const item of items) {
    const res = await fetch(ctx.pbUrl + '/api/collections/products/records/' + item.product)
    if (!res.ok) throw Object.assign(new Error('商品不存在'), { status: 400 })
    const product = await res.json()
    if (Number(product.stock) < Number(item.qty)) {
      throw Object.assign(new Error('库存不足: ' + product.name), { status: 400 })
    }
    total += Number(product.price) * Number(item.qty)
    normalized.push({ product: product.id, qty: Number(item.qty) })
  }

  const create = await fetch(ctx.pbUrl + '/api/collections/orders/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ctx.token },
    body: JSON.stringify({
      customer: ctx.auth.id,
      items: normalized,
      total,
      status: 'pending',
      address: ctx.body?.address ?? null,
    }),
  })
  const order = await create.json()
  if (!create.ok) throw Object.assign(new Error('订单创建失败: ' + (order.message ?? create.status)), { status: 502 })

  return { orderId: order.id, total, items: normalized, status: order.status }
}
`
