import { useCallback, useEffect, useMemo, useState } from 'react'
// 全部数据访问走 oneshot publish 生成的类型化客户端（web/src/api）
import { useAuth, useRecords, OneShotProvider } from './api/react'
import { createClient } from './api/client'
import type { BooksRecord } from './api/schema'

const PB = window.location.origin.startsWith('http://127.0.0.1:5174')
  ? window.location.origin.replace('5174', '8095')
  : window.location.origin

/* ---------------- 登录/注册 ---------------- */
function Login() {
  const { login, register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async (reg: boolean) => {
    setBusy(true); setMsg('')
    try {
      if (reg) await register({ email, password, passwordConfirm: password })
      await login(email, password)
    } catch (e: any) { setMsg(e?.message ?? String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="login-box card">
      <h1>📚 OneShot 图书馆</h1>
      <input placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {msg ? <div className="toast err" style={{ position: 'static', transform: 'none' }}>{msg}</div> : null}
      <div style={{ display: 'flex', gap: 10 }}>
        <button disabled={busy || !email || !password} onClick={() => go(false)} style={{ flex: 1 }}>登录</button>
        <button className="ghost" disabled={busy || !email || !password} onClick={() => go(true)} style={{ flex: 1 }}>注册读者</button>
      </div>
    </div>
  )
}

/* ---------------- 目录（书目卡 + 副本在架数 + 借/预约） ---------------- */
function Catalog({ onToast }: { onToast: (m: string, err?: boolean) => void }) {
  const api = useMemo(() => createClient(PB), [])
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const { items: books, loading, error, reload } = useRecords<BooksRecord>('books', {}, 1, 60)
  const { items: copies } = useRecords<any>('copies', {}, 1, 200)
  const { items: myResv, reload: reloadResv } = useRecords<any>('reservations', {}, 1, 50)

  const shelfByBook = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of copies ?? []) if (c.status === 'in_shelf') m[c.book] = (m[c.book] ?? 0) + 1
    return m
  }, [copies])

  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    try { const r = await fn(); onToast(ok(r)); reload(); reloadResv() }
    catch (e: any) { onToast(e?.message ?? String(e), true) }
  }

  const shown = (books ?? []).filter((b) =>
    (!q || b.title?.includes(q) || b.author?.includes(q) || b.isbn?.includes(q)) && (!cat || b.category === cat))

  return (
    <section>
      <div className="toolbar">
        <strong style={{ fontSize: 16 }}>📖 目录</strong>
        <input placeholder="搜书名 / 作者 / ISBN" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">全部分类</option>
          {['文学', '技术', '历史', '儿童', '其他'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {error ? <div className="empty">目录加载失败：{String((error as any)?.message ?? error)}</div> : null}
      {loading ? <div className="empty">加载中…</div> : (
        <div className="grid">
          {shown.map((b) => {
            const shelf = shelfByBook[b.id] ?? 0
            const myActiveResv = (myResv ?? []).find((r) => r.book === b.id && r.status === 'active')
            return (
              <div key={b.id} className="card book">
                <h3>{b.title} <span className="tag">{b.category}</span>{b.year ? <span className="tag">{b.year}</span> : null}</h3>
                <div className="meta">
                  {b.author || '佚名'} · {b.publisher || '—'}<br />
                  <span className={`avail ${shelf > 0 ? 'ok' : 'no'}`}>{shelf > 0 ? `在架 ${shelf} 册` : '全部借出'}</span>
                  {myActiveResv ? <span className="tag due-soon"> 预约中</span> : null}
                </div>
                <div style={{ marginTop: 10 }}>
                  {shelf > 0
                    ? <button disabled={!user} onClick={() => act(() => api.books.borrow({ book: b.id }),
                        (r) => `已借《${b.title}》 条码 ${r.barcode}，应还 ${String(r.due).slice(0, 10)}`)}>借这本书</button>
                    : <button className="ghost" disabled={!user || !!myActiveResv} onClick={() => act(() => api.books.reserve({ book: b.id }),
                        (r) => `已预约《${b.title}》，队列第 ${r.queuePosition} 位`)}>{myActiveResv ? '已预约' : '预约排队'}</button>}
                </div>
              </div>
            )
          })}
          {shown.length === 0 && <div className="empty">没有匹配的图书</div>}
        </div>
      )}
    </section>
  )
}

/* ---------------- 我的（借阅含条码/罚款 + 预约 + 欠款） ---------------- */
function Mine({ onToast }: { onToast: (m: string, err?: boolean) => void }) {
  const api = useMemo(() => createClient(PB), [])
  const { user } = useAuth()
  const { items: all, loading, reload } = useRecords<any>('borrowings', {}, 1, 200)
  const { items: copies } = useRecords<any>('copies', {}, 1, 200)
  const { items: books } = useRecords<BooksRecord>('books', {}, 1, 100)
  const { items: resv, reload: reloadResv } = useRecords<any>('reservations', {}, 1, 50)

  const mine = (all ?? []).filter((r) => r.member === user?.id)
  const copyOf = (id: string) => copies?.find((c) => c.id === id)
  const bookOfCopy = (copyId: string) => books?.find((b) => b.id === copyOf(copyId)?.book)
  const myResv = (resv ?? []).filter((r) => r.member === user?.id)

  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    try { const r = await fn(); onToast(ok(r)); reload(); reloadResv() }
    catch (e: any) { onToast(e?.message ?? String(e), true) }
  }

  if (loading) return <div className="empty">加载中…</div>
  return (
    <>
      {Number(user?.fines ?? 0) > 0 && (
        <div className="card" style={{ borderColor: '#7f1d1d' }}>
          💰 当前欠款 <strong style={{ color: '#f87171' }}>{user.fines} 元</strong>
          {Number(user.fines) >= 10 ? <span className="tag overdue">已达上限，暂停外借</span> : null}
          <span style={{ color: '#a1a1aa', fontSize: 13 }}>（逾期 0.5 元/天 · 请到服务台缴纳）</span>
        </div>
      )}
      <section className="card">
        <strong style={{ fontSize: 16 }}>📑 我的借阅（{mine.filter((r) => !r.returnedAt).length}/{user?.maxBorrow ?? 5}）</strong>
        {mine.length === 0 ? <div className="empty">还没有借阅记录</div> : (
          <table>
            <thead><tr><th>书</th><th>条码</th><th>应还</th><th>状态</th><th>罚</th><th></th></tr></thead>
            <tbody>
              {mine.map((r) => {
                const copy = copyOf(r.copy)
                const book = bookOfCopy(r.copy)
                const overdue = !r.returnedAt && new Date(r.due) < new Date()
                return (
                  <tr key={r.id}>
                    <td>{book?.title ?? r.copy}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{copy?.barcode ?? '—'}</td>
                    <td>{String(r.due).slice(0, 10)}<br /><span style={{ color: '#71717a', fontSize: 12 }}>续 {r.renewals ?? 0}/2</span></td>
                    <td>
                      {r.returnedAt
                        ? <span className="tag">已还 {String(r.returnedAt).slice(0, 10)}</span>
                        : overdue
                          ? <span className="tag overdue">逾期</span>
                          : <span className={`tag ${new Date(r.due).getTime() - Date.now() < 3 * 864e5 ? 'due-soon' : ''}`}>在借</span>}
                    </td>
                    <td>{Number(r.fine ?? 0) > 0 ? <span style={{ color: '#f87171' }}>{r.fine}元</span> : '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {!r.returnedAt && (
                        <>
                          <button className="ghost" disabled={overdue || Number(r.renewals ?? 0) >= 2}
                            onClick={() => act(() => api.books.renew({ book: copy?.book }), (r2) => `已续借至 ${String(r2.newDue).slice(0, 10)}`)}>续借</button>
                          <button onClick={() => act(() => api.books.returnBook({ copy: r.copy }),
                            (r2) => r2.fine > 0 ? `已归还，逾期罚款 ${r2.fine} 元已计入欠款` : '已归还')}>归还</button>
                          <button className="ghost" title="遗失赔书 30 元"
                            onClick={() => { if (confirm('确认报失？将按 30 元/册计入欠款')) act(() => api.books.reportLost({ borrowing: r.id }), () => '已报失，赔款计入欠款') }}>报失</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <strong style={{ fontSize: 16 }}>🔖 我的预约</strong>
        {myResv.length === 0 ? <div className="empty">没有预约</div> : (
          <table>
            <thead><tr><th>书</th><th>状态</th><th></th></tr></thead>
            <tbody>
              {myResv.map((r) => (
                <tr key={r.id}>
                  <td>{books?.find((b) => b.id === r.book)?.title ?? r.book}</td>
                  <td><span className="tag">{r.status === 'active' ? '排队中' : r.status === 'fulfilled' ? '已兑现' : '已取消'}</span></td>
                  <td>{r.status === 'active' && (
                    <button className="ghost" onClick={() => act(() => api.books.cancelReservation({ reservation: r.id }), () => '已取消预约')}>取消</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

/* ---------------- 管理员（librarian） ---------------- */
function Admin({ onToast }: { onToast: (m: string, err?: boolean) => void }) {
  const api = useMemo(() => createClient(PB), [])
  const { user, refresh } = useAuth()
  const { items: users, reload: reloadUsers } = useRecords<any>('users', {}, 1, 100)
  const { reload: reloadBooks } = useRecords<BooksRecord>('books', {}, 1, 60)
  const [form, setForm] = useState({ title: '', isbn: '', author: '', publisher: '', category: '技术', year: '', copies: 2, location: '', summary: '' })
  const setF = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }))

  if (user?.role !== 'librarian') return null

  const addBook = async () => {
    try {
      const r = await api.books.addBookWithCopies({ ...form, year: form.year ? Number(form.year) : undefined, copies: Number(form.copies) })
      onToast(`已入库《${r.title}》：${r.barcodes.join('、')}`)
      setForm({ title: '', isbn: '', author: '', publisher: '', category: '技术', year: '', copies: 2, location: '', summary: '' })
      reloadBooks()
    } catch (e: any) { onToast(e?.message ?? String(e), true) }
  }
  const act = async (fn: () => Promise<any>, ok: string, after?: () => void) => {
    try { await fn(); onToast(ok); reloadUsers(); after?.() }
    catch (e: any) { onToast(e?.message ?? String(e), true) }
  }

  return (
    <>
      <section className="card">
        <strong style={{ fontSize: 16 }}>🗄 图书入库（书目 + 副本一次建齐，条码自动生成）</strong>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <input placeholder="书名 *" value={form.title} onChange={(e) => setF('title', e.target.value)} style={{ minWidth: 130 }} />
          <input placeholder="ISBN *" value={form.isbn} onChange={(e) => setF('isbn', e.target.value)} />
          <input placeholder="作者" value={form.author} onChange={(e) => setF('author', e.target.value)} />
          <input placeholder="出版社" value={form.publisher} onChange={(e) => setF('publisher', e.target.value)} />
          <select value={form.category} onChange={(e) => setF('category', e.target.value)}>
            {['文学', '技术', '历史', '儿童', '其他'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input placeholder="年份" value={form.year} onChange={(e) => setF('year', e.target.value)} style={{ width: 64 }} />
          <input type="number" min={1} max={50} value={form.copies} onChange={(e) => setF('copies', e.target.value)} style={{ width: 60 }} title="副本数" />
          <input placeholder="架位" value={form.location} onChange={(e) => setF('location', e.target.value)} style={{ width: 70 }} />
          <button disabled={!form.title || !form.isbn} onClick={addBook}>入库</button>
        </div>
      </section>
      <section className="card">
        <strong style={{ fontSize: 16 }}>👥 读者管理</strong>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>在借上限</th><th>欠款</th><th>操作</th></tr></thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td><span className="tag">{u.role ?? 'reader'}</span></td>
                <td>{u.blocked ? <span className="tag overdue">已封禁</span> : <span className="tag">正常</span>}</td>
                <td>{u.maxBorrow ?? 5}</td>
                <td>{Number(u.fines ?? 0) > 0 ? <span style={{ color: '#f87171' }}>{u.fines} 元</span> : '—'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {u.id !== user?.id && (
                    <>
                      <button className="ghost" onClick={() => act(() => api.books.setRole({ member: u.id, role: u.role === 'librarian' ? 'reader' : 'librarian' }), u.role === 'librarian' ? '已降为读者' : '已提升为管理员')}>{u.role === 'librarian' ? '降权' : '提权'}</button>
                      <button className="ghost" onClick={() => act(() => api.books.setBanned({ member: u.id, banned: !u.blocked }), u.blocked ? '已解封' : '已封禁')}>{u.blocked ? '解封' : '封禁'}</button>
                    </>
                  )}
                  {Number(u.fines ?? 0) > 0 && (
                    <button onClick={() => act(() => api.books.settleFines({ member: u.id }), `已收款 ${u.fines} 元`)}>收款</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button className="ghost" onClick={() => act(async () => { await refresh() }, '已刷新会话（角色/欠款同步）')}>刷新我的会话</button>
        </div>
      </section>
    </>
  )
}

/* ---------------- 应用外壳 ---------------- */
function Shell() {
  const { user, logout } = useAuth()
  const [toast, setToast] = useState<{ m: string; err?: boolean; k: number } | null>(null)
  const onToast = useCallback((m: string, err?: boolean) => setToast({ m, err, k: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3600)
    return () => clearTimeout(t)
  }, [toast])

  if (!user) return <Login />
  return (
    <>
      <header>
        <span style={{ fontSize: 20 }}>📚</span>
        <strong>OneShot 图书馆</strong>
        {user.role === 'librarian' ? <span className="tag due-soon">管理员</span> : null}
        <span className="who">
          {user.email}
          {Number(user.fines ?? 0) > 0 ? <span style={{ color: '#f87171' }}> · 欠款 {user.fines} 元</span> : null}
          <button className="ghost" onClick={() => logout()}>退出</button>
        </span>
      </header>
      <main>
        <Catalog onToast={onToast} />
        <Mine onToast={onToast} />
        <Admin onToast={onToast} />
      </main>
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`} key={toast.k}>{toast.m}</div>}
    </>
  )
}

export function App() {
  return (
    <OneShotProvider baseUrl={PB}>
      <Shell />
    </OneShotProvider>
  )
}
