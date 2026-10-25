import { spawn, execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

export const DEFAULT_PB_VERSION = '0.40.6'

export interface EnginePaths {
  bin: string
  dataDir: string
  hooksDir: string
  pidFile: string
  logFile: string
  root: string
}

/** 引擎工件统一放在 <cwd>/.oneshot 下 */
export function enginePaths(cwd: string = process.cwd()): EnginePaths {
  const root = resolve(cwd, '.oneshot')
  return {
    root,
    bin: resolve(root, `pocketbase${process.platform === 'win32' ? '.exe' : ''}`),
    dataDir: resolve(root, 'pb_data'),
    hooksDir: resolve(cwd, 'pb_hooks'),
    pidFile: resolve(root, 'pb.pid'),
    logFile: resolve(root, 'pb.log'),
  }
}

function pbAsset(version: string): string {
  const osMap: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
  const archMap: Record<string, string> = { x64: 'amd64', arm64: 'arm64' }
  const os = osMap[process.platform]
  const arch = archMap[process.arch]
  if (!os || !arch) throw new Error(`不支持的平台：${process.platform}/${process.arch}`)
  return `pocketbase_${version}_${os}_${arch}.zip`
}

export async function engineInstall(version: string = DEFAULT_PB_VERSION, cwd: string = process.cwd()): Promise<string> {
  const paths = enginePaths(cwd)
  mkdirSync(paths.root, { recursive: true })
  if (existsSync(paths.bin)) {
    return paths.bin
  }
  const asset = pbAsset(version)
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/${asset}`
  process.stdout.write(`⬇️  下载 PocketBase v${version} …\n   ${url}\n`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}（${url}）`)
  const buf = Buffer.from(await res.arrayBuffer())
  const zipPath = resolve(paths.root, 'pb.zip')
  writeFileSync(zipPath, buf)

  if (process.platform === 'win32') {
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${paths.root}'`], { stdio: 'inherit' })
  } else {
    const unzip = spawnSync('unzip', ['-o', zipPath, '-d', paths.root], { stdio: 'pipe' })
    if (unzip.status !== 0) {
      throw new Error(`解压失败（需要系统安装 unzip）：${unzip.stderr?.toString()}`)
    }
  }
  rmSync(zipPath)
  if (!existsSync(paths.bin)) throw new Error(`解压后未找到二进制：${paths.bin}`)
  if (process.platform !== 'win32') {
    spawnSync('chmod', ['+x', paths.bin])
  }
  process.stdout.write(`✅ PocketBase v${version} 就绪：${paths.bin}\n`)
  return paths.bin
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1200) })
    return res.ok
  } catch {
    return false
  }
}

export async function waitForHealth(baseUrl: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isHealthy(baseUrl)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

export interface EngineUpOptions {
  port?: number
  host?: string
  version?: string
  cwd?: string
}

export async function engineUp(opts: EngineUpOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd()
  const paths = enginePaths(cwd)
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 8090
  const url = `http://${host}:${port}`

  if (await isHealthy(url)) {
    return url
  }
  if (!existsSync(paths.bin)) {
    await engineInstall(opts.version, cwd)
  }
  mkdirSync(paths.dataDir, { recursive: true })
  mkdirSync(paths.hooksDir, { recursive: true })

  const logFd = openSync(paths.logFile, 'a')
  const child = spawn(paths.bin, [
    'serve',
    '--http', `${host}:${port}`,
    '--dir', paths.dataDir,
    '--hooksDir', paths.hooksDir,
    // 迁移目录隔离在 .oneshot 内：PB 默认用 <dataDir>/../pb_migrations（项目根），
    // 历史 automigrate 会在"删 pb_data 重来"时重放，让旧 schema 转世（实测踩坑）
    '--migrationsDir', resolve(paths.root, 'pb_migrations'),
  ], { detached: true, stdio: ['ignore', logFd, logFd] })
  child.unref()
  writeFileSync(paths.pidFile, String(child.pid))

  const ok = await waitForHealth(url)
  if (!ok) throw new Error(`PocketBase 启动超时，日志见 ${paths.logFile}`)
  return url
}

export async function engineDown(cwd: string = process.cwd()): Promise<boolean> {
  const paths = enginePaths(cwd)
  if (!existsSync(paths.pidFile)) return false
  const pid = Number(readFileSync(paths.pidFile, 'utf8').trim())
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // 进程已不在
  }
  rmSync(paths.pidFile)
  return true
}

export function engineSuperuser(email: string, password: string, cwd: string = process.cwd()): void {
  const paths = enginePaths(cwd)
  if (!existsSync(paths.bin)) throw new Error('尚未安装引擎，请先运行 oneshot engine install')
  mkdirSync(paths.dataDir, { recursive: true })
  execFileSync(paths.bin, ['superuser', 'upsert', email, password, '--dir', paths.dataDir], { stdio: 'inherit' })
}

/** 解析控制台前端 dist 目录（随 @oneshot/console 包分发） */
export function consoleDist(): string {
  const req = createRequire(import.meta.url)
  const pkg = req.resolve('@oneshot/console/package.json')
  return resolve(dirname(pkg), 'dist')
}
