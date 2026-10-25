// 套件 5：内置模板（init → publish → 业务行为）
// sidecar checkout 不在此套件（由夹具的 sidecar 套件覆盖转发能力）；这里验证 blog/shop/chat 的 JSVM 可靠面。
import { PB, assert, summary, superuserLogin, j, makeUser } from '../helpers.mjs'

// 模板已由 runner 预发布（hooks 随主实例冷重启就绪）；此处只做业务行为断言
const H = { 'Content-Type': 'application/json', Authorization: await superuserLogin(PB) }

const a = await makeUser()
const b = await makeUser()

// ---------- blog ----------
const post = await j(PB, 'POST', '/api/collections/posts/records', { title: 'Hello World', status: 'published', author: a.id }, a.token)
assert('blog: 用户创建文章（owner=author）', post.status === 200, JSON.stringify(post.data))
assert('blog: slug 留空自动生成（JSVM 钩子）', /^[a-z0-9-]+$/.test(post.data.slug || ''), post.data.slug)
const forged = await j(PB, 'POST', '/api/collections/posts/records', { title: 'x', slug: 'x', status: 'published', author: b.id }, a.token)
assert('blog: 冒充 author 被拒', forged.status === 400)
const comment = await j(PB, 'POST', '/api/collections/comments/records', { post: post.data.id, body: '好文', author: b.id }, b.token)
assert('blog: 登录用户评论', comment.status === 200)
const feature = await j(PB, 'POST', '/api/oneshot/posts/feature', { id: post.data.id }, H.Authorization)
assert('blog: feature action（超管）', feature.status === 200 && feature.data.featured === true, JSON.stringify(feature.data))

// ---------- shop ----------
const product = await j(PB, 'POST', '/api/collections/products/records', { name: '咖啡豆', price: 39.9, stock: 10, category: 'food' }, H.Authorization)
assert('shop: 超管建商品', product.status === 200)
const anonProduct = await j(PB, 'POST', '/api/collections/products/records', { name: 'x', price: 1, stock: 1, category: 'food' }, a.token)
assert('shop: 普通用户建商品被拒', anonProduct.status === 400 || anonProduct.status === 403)
const order = await j(PB, 'POST', '/api/collections/orders/records', { customer: a.id, items: [{ product: product.data.id, qty: 2 }], total: 79.8, status: 'pending' }, a.token)
assert('shop: 直建订单（owner=customer）', order.status === 200, JSON.stringify(order.data))
const restock = await j(PB, 'POST', '/api/oneshot/shop/restock', { product: product.data.id, qty: 5 }, H.Authorization)
assert('shop: restock action', restock.status === 200 && restock.data.stock === 15, JSON.stringify(restock.data))
const otherOrders = await j(PB, 'GET', '/api/collections/orders/records', undefined, b.token)
assert('shop: 订单 owner 隔离', otherOrders.data.totalItems === 0)

// ---------- chat ----------
const room = await j(PB, 'POST', '/api/collections/rooms/records', { name: '公共大厅' }, a.token)
assert('chat: 登录用户建房', room.status === 200)
const msg = await j(PB, 'POST', '/api/collections/messages/records', { room: room.data.id, sender: a.id, text: '  大家好  ' }, a.token)
assert('chat: 发消息（owner=sender）', msg.status === 200)
assert('chat: 消息 trim 钩子', msg.data.text === '大家好', msg.data.text)
const blank = await j(PB, 'POST', '/api/collections/messages/records', { room: room.data.id, sender: b.id, text: '   ' }, b.token)
assert('chat: 空白消息被钩子拒绝', blank.status === 400)
const msgs = await j(PB, 'GET', '/api/collections/messages/records', undefined, b.token)
assert('chat: 消息 authenticated 可读', msgs.status === 200 && msgs.data.totalItems >= 1)

summary('templates')
