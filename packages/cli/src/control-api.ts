import { copyFile, writeFile } from 'node:fs/promises'
import {
  loadManifest,
  publish,
  serializeConfig,
  validateConfig,
  type PublishReport,
  type ResolvedManifest,
} from '@oneshot/core'

/**
 * /api/manifest —— 控制台编辑写回：
 * GET  读配置对象；POST 校验 → 备份 .bak → 序列化写回 oneshot.config.ts → 立即重新发布。
 * GitOps 不破功：写的是文件本身，可 git diff/回滚；鉴权用浏览器持有的超管 token。
 */

export interface ManifestApiOptions {
  getManifest: () => ResolvedManifest | null
  /** 写回并发布成功后回调（更新内存 manifest、重建 sidecar registry） */
  onManifestUpdated: (fresh: ResolvedManifest, report: PublishReport) => Promise<void> | void
  pbUrl: string
  log?: (msg: string) => void
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function verifySuperuserToken(pbUrl: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${pbUrl}/api/collections?perPage=1`, {
      headers: { Authorization: token },
      // 5 秒超时：PB 不可达时快速拒绝，不让写回请求挂着
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 读取请求体，超上限抛错（调用方回 413） */
async function readBody(req: import('node:http').IncomingMessage, limitBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > limitBytes) throw new Error(`request body too large (max ${limitBytes} bytes)`)
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createManifestApi(opts: ManifestApiOptions): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    if (url.pathname !== '/api/manifest') return false

    const manifest = opts.getManifest()
    if (!manifest) {
      json(res, 404, { error: '当前目录没有 oneshot.config.ts（--config 可指定）' })
      return true
    }

    const token = (req.headers.authorization ?? '').trim()
    if (!token || !(await verifySuperuserToken(opts.pbUrl, token))) {
      json(res, 401, { error: '需要超管 token' })
      return true
    }

    if (req.method === 'GET') {
      json(res, 200, { config: manifest.config, path: manifest.path })
      return true
    }

    if (req.method === 'POST') {
      // 写回的是整个配置对象，给 2MB 上限；请求体必须是 application/json
      const contentType = String(req.headers['content-type'] ?? '')
      if (!contentType.includes('application/json')) {
        json(res, 415, { error: `expected application/json, got: ${contentType || '(none)'}` })
        return true
      }
      let raw: string
      try {
        raw = await readBody(req, 2 * 1024 * 1024)
      } catch {
        json(res, 413, { error: 'request body too large (max 2MB)' })
        return true
      }
      let body: { config?: any }
      try {
        body = JSON.parse(raw)
      } catch {
        json(res, 400, { error: 'invalid JSON body' })
        return true
      }
      const nextConfig = body?.config
      if (!nextConfig || !Array.isArray(nextConfig.services) || !nextConfig.name) {
        json(res, 400, { error: '缺少 config（需含 name 与 services）' })
        return true
      }
      try {
        validateConfig(nextConfig, manifest.root)
      } catch (err: any) {
        json(res, 400, { error: err?.message ?? String(err) })
        return true
      }

      await copyFile(manifest.path, `${manifest.path}.bak`)
      await writeFile(manifest.path, serializeConfig(nextConfig), 'utf8')

      try {
        const fresh = await loadManifest(manifest.path)
        const report = await publish({
          manifest: fresh,
          superuserToken: token,
          log: (msg) => opts.log?.(msg),
        })
        await opts.onManifestUpdated(fresh, report)
        json(res, 200, { report })
      } catch (err: any) {
        json(res, 500, { error: `manifest 已写回（备份 .bak），但发布失败：${err?.message ?? err}` })
      }
      return true
    }

    json(res, 405, { error: 'method not allowed' })
    return true
  }
}
