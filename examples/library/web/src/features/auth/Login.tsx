import { useState } from 'react'
import { useAuth } from '../../api/react'
import type { UsersRecord } from '../../api/schema'
import { errorMessage } from '../../shared/errors'

export function Login() {
  const { login, register } = useAuth<UsersRecord>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (signup: boolean) => {
    setBusy(true)
    setMessage('')
    try {
      if (signup) await register({ email, password, passwordConfirm: password })
      await login(email, password)
    } catch (error: unknown) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={(event) => { event.preventDefault(); void submit(false) }}>
        <div className="brand-mark">OneShot</div>
        <h1>图书馆，重新开卷</h1>
        <p>搜索馆藏、管理借阅，让每一本书都有迹可循。</p>
        <label>邮箱<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {message && <div className="inline-error" role="alert">{message}</div>}
        <button disabled={busy || !email || password.length < 8}>{busy ? '请稍候…' : '登录'}</button>
        <button type="button" className="secondary" disabled={busy || !email || password.length < 8} onClick={() => void submit(true)}>注册读者账号</button>
        <small>新账号默认为读者（最多借 5 册），由管理员分配其他角色。密码至少 8 位。</small>
      </form>
    </main>
  )
}
