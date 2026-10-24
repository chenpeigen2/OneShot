import type { OneshotConfig } from '@oneshot/core'
import { blogConfig, BLOG_HOOKS_POSTS } from './blog.js'
import { chatConfig, CHAT_HOOKS_CHAT } from './chat.js'
import { shopConfig, SHOP_HOOKS_ORDERS } from './shop.js'
import { SHOP_HOOKS_ORDERS_SIDECAR } from './orders-sidecar.js'
import { todoConfig, TODO_HOOKS_TASKS } from './todo.js'

export interface Template {
  name: string
  title: string
  description: string
  config: () => OneshotConfig
  /** 相对路径 -> 文件内容（hooks 等） */
  hooks: Record<string, string>
}

export const TEMPLATES: Record<string, Template> = {
  todo: {
    name: 'todo',
    title: '待办清单',
    description: '最小入门示例：tasks collection + owner 规则 + stats action',
    config: todoConfig,
    hooks: { 'hooks/tasks.ts': TODO_HOOKS_TASKS },
  },
  blog: {
    name: 'blog',
    title: '博客',
    description: '文章/评论：editor 富文本、slug 唯一索引、公开读 + 属主写、级联删除评论、feature action',
    config: blogConfig,
    hooks: { 'hooks/posts.ts': BLOG_HOOKS_POSTS },
  },
  shop: {
    name: 'shop',
    title: '商城',
    description: '商品/订单：公开读商品、属主订单、JSON 订单项、下单前库存校验、restock action',
    config: shopConfig,
    hooks: { 'hooks/orders.ts': SHOP_HOOKS_ORDERS, 'hooks/orders.sidecar.ts': SHOP_HOOKS_ORDERS_SIDECAR },
  },
  chat: {
    name: 'chat',
    title: '聊天',
    description: '房间/成员/消息三表：组合唯一索引、级联删除、realtime 友好',
    config: chatConfig,
    hooks: { 'hooks/chat.ts': CHAT_HOOKS_CHAT },
  },
}

export function templateNames(): string[] {
  return Object.keys(TEMPLATES)
}
