import type { OneshotConfig } from '@oneshot/core'
import { defineConfig, s, service } from '@oneshot/core'

/** 聊天模板：房间/成员表/消息三表，组合唯一索引、级联删除、realtime 友好 */
export function chatConfig(): OneshotConfig {
  return defineConfig({
    name: 'chat',
    baseUrl: 'http://127.0.0.1:8090',
    auth: { collection: 'users', signup: 'public' },
    services: [
      service('chat', {
        title: '聊天',
        collections: {
          rooms: {
            fields: {
              name: s.text({ required: true, max: 100, presentable: true }),
              isPrivate: s.bool({ default: false }),
              lastMessageAt: s.date(),
            },
            rules: { list: 'authenticated', view: 'authenticated', create: 'authenticated', update: 'superuser', delete: 'superuser' },
          },
          members: {
            fields: {
              room: s.relation('rooms', { required: true, cascade: true }),
              user: s.relation('users', { required: true, cascade: true }),
              role: s.select(['member', 'admin'], { required: true, default: 'member' }),
            },
            indexes: ['CREATE UNIQUE INDEX idx_chat_members_room_user ON members (room, user)'],
            rules: { list: 'authenticated', view: 'authenticated', create: 'authenticated', update: 'superuser', delete: 'owner' },
          },
          messages: {
            fields: {
              room: s.relation('rooms', { required: true }),
              sender: s.relation('users', { required: true }),
              text: s.text({ required: true, max: 4000 }),
            },
            indexes: ['CREATE INDEX idx_chat_messages_room ON messages (room)'],
            // sender 是首个指向 users 的 relation —— owner 预设自动落到它身上
            rules: { list: 'authenticated', view: 'authenticated', create: 'owner', update: 'owner', delete: 'owner' },
            // collection 级 hooks：trim 与 lastMessageAt 更新只对 messages 生效
            hooks: './hooks/chat.ts',
          },
        },
      }),
    ],
    clients: { ts: { outDir: './web/src/api' }, dart: { outDir: './mobile/lib/api' } },
  })
}

export const CHAT_HOOKS_CHAT = `// chat 服务的 hooks（oneshot publish 编译进 PB JSVM）
// ctx: { e, app, record?, auth?, query?, body?, http, log }

// 消息 trim 校验（onRecordValidate 实测可靠）。
// 注意：房间 lastMessageAt 戳等「跨 record 写值」逻辑在 v0.40.6 JSVM 里有持久化怪癖，
// 需要时请走 sidecar action（详见 README 已知约束）。
export function beforeValidate(ctx: any) {
  const text = String(ctx.record.get('text') ?? '')
  if (!text.trim()) throw new BadRequestError('消息不能为空')
  ctx.record.set('text', text.trim())
}
`
