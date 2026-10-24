import type { OneshotConfig } from '@oneshot/core'
import { defineConfig, s, service } from '@oneshot/core'

/** 博客模板：editor/文件/slug 唯一索引/公开读 + 属主写/级联删除评论 */
export function blogConfig(): OneshotConfig {
  return defineConfig({
    name: 'blog',
    baseUrl: 'http://127.0.0.1:8090',
    auth: { collection: 'users', signup: 'public' },
    services: [
      service('posts', {
        title: '博客',
        collections: {
          posts: {
            fields: {
              title: s.text({ required: true, max: 200, presentable: true }),
              slug: s.text({ required: true, max: 120, pattern: '^[a-z0-9-]+$' }),
              content: s.editor(),
              cover: s.file({ maxSelect: 1, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] }),
              status: s.select(['draft', 'published'], { required: true, default: 'draft' }),
              featured: s.bool({ default: false }),
              publishedAt: s.date(),
              tags: s.select(['tech', 'life', 'news'], { multi: true }),
              author: s.relation('users', { required: true }),
            },
            indexes: ['CREATE UNIQUE INDEX idx_blog_posts_slug ON posts (slug)'],
            rules: { list: 'public', view: 'public', create: 'owner', update: 'owner', delete: 'owner' },
            // collection 级 hooks：生命周期导出只对这个 collection 生效
            hooks: './hooks/posts.ts',
          },
          comments: {
            fields: {
              post: s.relation('posts', { required: true, cascade: true }),
              body: s.text({ required: true, max: 2000 }),
              author: s.relation('users', { required: true }),
            },
            indexes: ['CREATE INDEX idx_blog_comments_post ON comments (post)'],
            rules: { list: 'public', view: 'public', create: 'authenticated', update: 'owner', delete: 'owner' },
          },
        },
        actions: {
          feature: { method: 'POST', rule: 'superuser', handler: './hooks/posts.ts#feature' },
        },
      }),
    ],
    clients: { ts: { outDir: './web/src/api' }, dart: { outDir: './mobile/lib/api' } },
  })
}

export const BLOG_HOOKS_POSTS = `// posts 服务的 hooks 与 action（oneshot publish 编译进 PB JSVM）
// ctx: { e, app, record?, auth?, query?, body?, http, log }
// 拒绝请求抛 PB 内置错误：BadRequestError / ForbiddenError / ...

export function beforeValidate(ctx: any) {
  // slug 留空时从标题生成（goja 内无 npm，手写 slugify）
  const slug = String(ctx.record.get('slug') ?? '').trim()
  if (!slug) {
    const title = String(ctx.record.get('title') ?? 'post')
    const base = title.toLowerCase().replace(/[^a-z0-9\\u4e00-\\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'post'
    ctx.record.set('slug', base + '-' + Date.now().toString(36))
  }
}

// POST /api/oneshot/posts/feature —— 切换精选（仅超管）
export function feature(ctx: any) {
  const id = String(ctx.body?.id ?? '')
  if (!id) throw new BadRequestError('缺少 id')
  const post = ctx.app.findRecordById('posts', id)
  const next = !post.get('featured')
  post.set('featured', next)
  ctx.app.save(post)
  return { id, featured: next }
}
`
