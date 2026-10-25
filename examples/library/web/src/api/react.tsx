// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import PocketBase from 'pocketbase'
import type { RecordListOptions } from 'pocketbase'
import type { OneShotClient } from './client'
import { createClient } from './client'

const PbContext = createContext<PocketBase | null>(null)
const DEFAULT_BASE_URL = typeof window !== 'undefined' && !window.location.origin.includes('localhost') ? window.location.origin : 'http://127.0.0.1:8090'

export function OneShotProvider({ client, baseUrl, children }: { client?: OneShotClient; baseUrl?: string; children: ReactNode }) {
  const value = useMemo(
    () => client?.pb ?? createClient(baseUrl ?? DEFAULT_BASE_URL).pb,
    [client, baseUrl],
  )
  return <PbContext.Provider value={value}>{children}</PbContext.Provider>
}

export function usePB(): PocketBase {
  const pb = useContext(PbContext)
  if (!pb) throw new Error('usePB 必须在 <OneShotProvider> 内使用')
  return pb
}

export function useAuth() {
  const pb = usePB()
  const [record, setRecord] = useState<any>(() => pb.authStore.record)
  useEffect(() => pb.authStore.onChange(() => setRecord(pb.authStore.record)), [pb])
  const login = useCallback(
    (email: string, password: string) => pb.collection('users').authWithPassword(email, password),
    [pb],
  )
  const register = useCallback(
    (data: Record<string, any>) => pb.collection('users').create(data),
    [pb],
  )
  const logout = useCallback(() => pb.authStore.clear(), [pb])
  // 刷新会话：角色/资料在登录后被修改时重新拉取 auth record（否则 user 停留在旧 JWT 快照）
  const refresh = useCallback(async () => { await pb.collection('users').authRefresh() }, [pb])
  return { user: record as any, token: pb.authStore.token, login, register, logout, refresh }
}

export function useRecords<T = any>(collection: string, options: RecordListOptions = {}, page = 1, perPage = 20) {
  const pb = usePB()
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const optionsKey = JSON.stringify(options ?? {})
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      // requestKey: null —— 禁用 SDK autoCancel：多个 useRecords 并发时避免互相取消
      const res = await pb.collection(collection).getList<T>(page, perPage, { ...JSON.parse(optionsKey), requestKey: null })
      setItems(res.items)
      setTotal(res.totalItems)
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [pb, collection, page, perPage, optionsKey])
  useEffect(() => {
    let alive = true
    let unsub: (() => void) | undefined
    reload()
    pb.collection(collection)
      .subscribe('*', () => { if (alive) reload() })
      .then((fn) => { if (!alive) fn(); else unsub = fn })
      .catch(() => {})
    return () => {
      alive = false
      unsub?.()
    }
  }, [reload])
  return { items, total, loading, error, reload }
}
