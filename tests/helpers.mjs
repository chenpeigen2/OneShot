// e2e 共享工具：所有套件从环境变量读取目标实例，进程退出码即结果。
export const PB = process.env.TEST_PB || 'http://127.0.0.1:8099'
export const CTRL = process.env.TEST_CTRL || 'http://127.0.0.1:7861'
export const STAGING = process.env.TEST_STAGING || 'http://127.0.0.1:8097'
export const SU_EMAIL = process.env.TEST_SU_EMAIL || 'admin@example.com'
export const SU_PASS = process.env.TEST_SU_PASS || 'oneshot123'

let passed = 0
let failed = 0

export function assert(name, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${cond ? '' : '  ' + extra}`)
  if (cond) passed++
  else failed++
  return cond
}

export function summary(suite) {
  console.log(`\n[${suite}] 通过 ${passed} · 失败 ${failed}`)
  if (failed > 0) process.exitCode = 1
  // 重置计数（套件可多次调用）
  const result = { passed, failed }
  passed = 0
  failed = 0
  return result
}

/** PB 请求小工具 */
export async function j(base, method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

/** 超管登录（_superusers） */
export async function superuserLogin(base = PB, identity = SU_EMAIL, password = SU_PASS) {
  const res = await j(base, 'POST', '/api/collections/_superusers/auth-with-password', { identity, password })
  if (res.status !== 200) throw new Error(`超管登录失败（${base}）：${JSON.stringify(res.data)}`)
  return res.data.token
}

/** 注册并登录一个普通用户，返回 { id, email, token } */
export async function makeUser(base = PB) {
  const email = `u${Date.now()}${Math.floor(Math.random() * 1000)}@test.dev`
  const reg = await j(base, 'POST', '/api/collections/users/records', {
    email, password: '1234567890', passwordConfirm: '1234567890',
  })
  if (reg.status !== 200) throw new Error(`注册失败：${JSON.stringify(reg.data)}`)
  const login = await j(base, 'POST', '/api/collections/users/auth-with-password', { identity: email, password: '1234567890' })
  if (login.status !== 200) throw new Error(`登录失败：${JSON.stringify(login.data)}`)
  return { id: reg.data.id, email, token: login.data.token }
}
