const FIELD_LABELS: Record<string, string> = {
  email: '邮箱',
  password: '密码',
  passwordConfirm: '确认密码',
  name: '姓名',
  role: '角色',
  blocked: '封禁状态',
  maxBorrow: '借阅上限',
  fines: '欠款',
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fieldMessage(field: string, value: unknown): string {
  const label = FIELD_LABELS[field] ?? field
  if (!isObject(value)) return `${label}：不合法`
  const code = typeof value.code === 'string' ? value.code : ''
  if (code === 'validation_not_unique') return `${label}：${field === 'email' ? '已被注册，请直接登录或更换' : '已被使用，请更换'}`
  if (code === 'validation_min_text_constraint') {
    const raw = typeof value.message === 'string' ? value.message : ''
    const min = raw.match(/at least (\d+)/)?.[1]
    return `${label}：${min ? `至少需要 ${min} 个字符` : '长度不足'}`
  }
  if (code === 'validation_required') return `${label}：不能为空`
  return `${label}：${typeof value.message === 'string' ? value.message : '不合法'}`
}

export function errorMessage(error: unknown): string {
  const body = isObject(error) && isObject(error.data) ? error.data : isObject(error) && isObject(error.response) ? error.response : undefined
  if (body && isObject(body.data)) {
    const details = Object.entries(body.data).map(([field, info]) => fieldMessage(field, info)).join('；')
    if (details) return details
  }
  if (body && typeof body.error === 'string') return body.error
  if (body && typeof body.message === 'string') return body.message
  if (error instanceof Error) return error.message
  return String(error)
}
