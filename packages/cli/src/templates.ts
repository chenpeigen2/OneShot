/** `oneshot init` 的通用脚手架内容（config 由模板注册表 + serializeConfig 生成） */

export const ENV_EXAMPLE = `# PocketBase 地址（发布目标）
ONESHOT_PB_URL=http://127.0.0.1:8090
# 超管账号（oneshot publish 使用；oneshot superuser <email> <pass> 创建）
ONESHOT_SUPERUSER_EMAIL=
ONESHOT_SUPERUSER_PASSWORD=
`

export const INIT_GITIGNORE = `.oneshot/
pb_hooks/*.pb.js
pb_hooks/*.user.pb.js
.env
`

export function renderTemplateReadme(t: { name: string; title: string; description: string }): string {
  return `# OneShot ${t.title}（${t.name}）

${t.description}

## 快速开始

\`\`\`bash
pnpm add @oneshot/core
oneshot engine install          # 下载 PocketBase 二进制到 .oneshot/
oneshot superuser admin@example.com 1234567890   # 首次：创建超管
oneshot dev                     # 启动引擎 + 发布服务 + 生成客户端 + 控制台/sidecar
\`\`\`

- 服务定义：\`oneshot.config.ts\`（控制台可编辑写回）；行为逻辑：\`hooks/*.ts\`
- 生成的客户端：\`web/src/api\`（TS/React）、\`mobile/lib/api\`（Dart/Flutter）
- PB Admin UI：http://127.0.0.1:8090/_/ ；OneShot 控制台：\`oneshot console\`
`
}
