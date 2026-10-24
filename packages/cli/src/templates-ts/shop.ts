import type { OneshotConfig } from '@oneshot/core'
import { defineConfig, s, service } from '@oneshot/core'

/** 商城模板：公开读商品/属主订单/superuser 管理商品/JSON 订单项/库存 action */
export function shopConfig(): OneshotConfig {
  return defineConfig({
    name: 'shop',
    baseUrl: 'http://127.0.0.1:8090',
    auth: { collection: 'users', signup: 'public' },
    services: [
      service('shop', {
        title: '商城',
        collections: {
          products: {
            fields: {
              name: s.text({ required: true, max: 200, presentable: true }),
              price: s.number({ required: true, min: 0 }),
              stock: s.number({ required: true, min: 0, onlyInt: true, default: 0 }),
              description: s.text({ max: 5000 }),
              category: s.select(['clothing', 'food', 'electronics'], { required: true }),
              images: s.file({ multi: true, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] }),
              active: s.bool({ default: true }),
            },
            indexes: ['CREATE INDEX idx_shop_products_category ON products (category)'],
            rules: { list: 'public', view: 'public', create: 'superuser', update: 'superuser', delete: 'superuser' },
          },
          orders: {
            fields: {
              customer: s.relation('users', { required: true }),
              items: s.json({ required: true }),
              total: s.number({ min: 0, default: 0 }),
              status: s.select(['pending', 'paid', 'shipped', 'done', 'cancelled'], { required: true, default: 'pending' }),
              address: s.json(),
            },
            indexes: ['CREATE INDEX idx_shop_orders_customer ON orders (customer)'],
            // customer 是首个指向 users 的 relation —— owner 预设自动落到它身上
            rules: { list: 'owner', view: 'owner', create: 'owner', update: 'superuser', delete: 'superuser' },
          },
        },
        actions: {
          // 库存校验 + 总价计算的权威路径跑在 sidecar（Node）：跨表读 + 业务规则 + 用用户身份回写
          checkout: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/orders.sidecar.ts#checkout' },
          restock: { method: 'POST', rule: 'superuser', handler: './hooks/orders.ts#restock' },
        },
      }),
    ],
    clients: { ts: { outDir: './web/src/api' }, dart: { outDir: './mobile/lib/api' } },
  })
}

export const SHOP_HOOKS_ORDERS = `// shop 服务的 action handler（oneshot publish 编译进 PB JSVM）
// ctx: { e, app, auth?, query?, body?, http, log }
//
// 库存校验与总价计算的权威路径在 sidecar 的 checkout（Node 进程，全 npm 生态）。

// POST /api/oneshot/shop/restock —— 补货（仅超管）
export function restock(ctx: any) {
  const productId = String(ctx.body?.product ?? '')
  const qty = Number(ctx.body?.qty ?? 0)
  if (!productId || qty <= 0) throw new BadRequestError('product 与 qty 必填')
  const product = ctx.app.findRecordById('products', productId)
  const next = Number(product.get('stock') ?? 0) + qty
  product.set('stock', next)
  ctx.app.save(product)
  return { id: productId, stock: next }
}
`
