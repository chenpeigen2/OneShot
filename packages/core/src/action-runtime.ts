export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface SidecarCtx<TBody = JsonObject> {
  service: string
  action: string
  auth: { id: string } | null
  /** 当前用户的 PB auth token（转发自原始请求，规则与身份原样生效） */
  token: string
  /** 系统服务账号 token，仅用于已经校验的系统级写操作 */
  systemToken: string
  pbUrl: string
  query: JsonObject
  body: TBody
}

export type SidecarHandler = (ctx: SidecarCtx) => Promise<unknown> | unknown

/**
 * 定义类型化 sidecar action。
 * decode 是外部 JSON 与内部 DTO 之间的强制接缝：在这里校验/收窄，而不是在 handler 里使用 any。
 */
export function defineSidecarAction<TBody, TResult>(
  decode: (body: JsonObject) => TBody,
  handler: (ctx: SidecarCtx<TBody>) => Promise<TResult> | TResult,
): SidecarHandler {
  return (ctx) => handler({ ...ctx, body: decode(ctx.body) })
}

const locks = new Map<string, Promise<void>>()

/** 同一控制进程内按排序后的 key 串行执行；数组形式用于避免多锁顺序不一致导致死锁。 */
export async function withSidecarLocks<T>(keys: string | string[], fn: () => Promise<T>): Promise<T> {
  if (Array.isArray(keys)) {
    const ordered = [...new Set(keys)].sort()
    const acquire = async (index: number): Promise<T> => index >= ordered.length
      ? fn()
      : withSidecarLocks(ordered[index], () => acquire(index + 1))
    return acquire(0)
  }
  const previous = locks.get(keys) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => { release = resolve })
  locks.set(keys, current)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(keys) === current) locks.delete(keys)
  }
}

export class SidecarActionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'SidecarActionError'
  }
}

export function sidecarErrorStatus(error: unknown): number {
  if (error instanceof SidecarActionError) return error.status
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) return status
  }
  return 500
}

export function sidecarErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}
