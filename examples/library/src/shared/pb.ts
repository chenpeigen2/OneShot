import { SidecarActionError, type SidecarCtx } from '@oneshot/core'
import { errorMessage, isObject, numberValue } from './values'

export type LibraryContext = SidecarCtx<unknown>
export type BatchRequest = { method: 'POST' | 'PATCH'; url: string; body?: unknown }
export interface BatchResult { status: number; body: unknown }

async function response(res: Response, system = false): Promise<unknown> {
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const prefix = system ? '系统操作失败：' : ''
    const status = res.status === 400 || res.status === 403 || res.status === 404 ? res.status : 502
    throw new SidecarActionError(`${prefix}${errorMessage(data) ?? `PB ${res.status}`}`, status)
  }
  return data
}

export async function pbGet<T>(
  ctx: LibraryContext,
  path: string,
  decode: (value: unknown) => T,
  system = false,
): Promise<T> {
  const res = await fetch(ctx.pbUrl + path, { headers: { Authorization: system ? ctx.systemToken : ctx.token } })
  return decode(await response(res, system))
}

export async function sysSend<T>(
  ctx: LibraryContext,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  decode: (value: unknown) => T,
): Promise<T> {
  const res = await fetch(ctx.pbUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: ctx.systemToken },
    body: JSON.stringify(body),
  })
  return decode(await response(res, true))
}

export async function sysBatch(ctx: LibraryContext, requests: BatchRequest[]): Promise<BatchResult[]> {
  const res = await fetch(ctx.pbUrl + '/api/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ctx.systemToken },
    body: JSON.stringify({ requests }),
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (res.status === 403) throw new SidecarActionError('PocketBase 批量事务未开启，请在 Settings > Application 启用 Batch', 500)
  if (!res.ok) throw new SidecarActionError(errorMessage(data) ?? '批量事务失败', res.status === 400 ? 400 : 502)
  if (!Array.isArray(data)) throw new Error('批量事务响应格式错误')
  return data.map((item): BatchResult => {
    if (!isObject(item)) throw new Error('批量事务子响应格式错误')
    return { status: numberValue(item.status, 'batch.status'), body: item.body }
  })
}

export const q = (value: string) => encodeURIComponent(value)
export const esc = (value: unknown) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
export const nowIso = () => new Date().toISOString()
