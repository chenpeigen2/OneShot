import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function serveFile(root: string, urlPath: string, res: import('node:http').ServerResponse): Promise<void> {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  const abs = join(root, safe)
  try {
    const st = await stat(abs)
    if (st.isFile()) {
      const body = await readFile(abs)
      res.writeHead(200, { 'Content-Type': MIME[extname(abs)] ?? 'application/octet-stream' })
      res.end(body)
      return
    }
  } catch {
    // fallthrough
  }
  // SPA fallback
  const index = await readFile(join(root, 'index.html'))
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(index)
}

export interface ControlServerOptions {
  distDir: string
  host: string
  port: number
  /** /api/* JSON API（manifest 写回、sidecar 转发等）；返回 true 表示已处理 */
  api?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean>
}

/** 控制服务器：只读控制台静态托管 + JSON API（manifest 写回 / sidecar），同一进程同一端口 */
export function serveControlServer(opts: ControlServerOptions): Promise<string> {
  const server = createServer((req, res) => {
    void (async () => {
      if (opts.api) {
        const handled = await opts.api(req, res)
        if (handled) return
      }
      const url = req.url ?? '/'
      await serveFile(opts.distDir, url === '/' ? 'index.html' : url.slice(1), res)
    })().catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: String(err?.message ?? err) }))
      } else {
        res.end()
      }
    })
  })
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(opts.port, opts.host, () => {
      resolvePromise(`http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${opts.port}`)
    })
  })
}
