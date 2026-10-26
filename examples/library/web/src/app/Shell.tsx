import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../api/react'
import type { UsersRecord } from '../api/schema'
import { Login } from '../features/auth/Login'
import { Catalog } from '../features/catalog/Catalog'
import { MyLibrary } from '../features/loans/MyLibrary'
import { Admin } from '../features/admin/Admin'
import { Tag } from '../shared/ui'
import type { Notify, Toast } from '../shared/types'

export function Shell() {
  const { user, logout } = useAuth<UsersRecord>()
  const [page, setPage] = useState('catalog')
  const [toast, setToast] = useState<Toast | null>(null)
  const notify = useCallback<Notify>((message, error) => setToast({ message, error, id: Date.now() }), [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  if (!user) return <Login />
  const isAdmin = user.role === 'librarian'
  return <>
    <header className="app-header"><button className="brand" onClick={() => setPage('catalog')}><span>OneShot</span> 图书馆</button><nav>{isAdmin && <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>管理工作台</button>}<button className={page === 'catalog' ? 'active' : ''} onClick={() => setPage('catalog')}>馆藏目录</button><button className={page === 'mine' ? 'active' : ''} onClick={() => setPage('mine')}>我的书房</button></nav><div className="account"><span>{user.email}</span><Tag tone={isAdmin ? 'warning' : ''}>{isAdmin ? '管理员' : '读者'}</Tag><button className="text-button" onClick={logout}>退出</button></div></header>
    <main className="app-main">{page === 'admin' && isAdmin ? <Admin notify={notify} /> : page === 'mine' ? <MyLibrary notify={notify} /> : <Catalog notify={notify} />}</main>
    {toast && <button className={`toast ${toast.error ? 'error' : ''}`} key={toast.id} onClick={() => setToast(null)}>{toast.message}<span>关闭</span></button>}
  </>
}
