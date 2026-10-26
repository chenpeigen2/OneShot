// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import PocketBase from 'pocketbase'
import type { RecordListOptions, RecordModel } from 'pocketbase'
import type { OneShotClient } from './client'
import type { UsersRecord, UsersRegisterInput } from './schema'
import { createClient } from './client'

const ClientContext = createContext<OneShotClient | null>(null)
const DEFAULT_BASE_URL = typeof window !== 'undefined' && !window.location.origin.includes('localhost') ? window.location.origin : 'http://127.0.0.1:8090'

export function OneShotProvider({ client, baseUrl, children }: { client?: OneShotClient; baseUrl?: string; children: ReactNode }) {
  const value = useMemo(
    () => client ?? createClient(baseUrl ?? DEFAULT_BASE_URL),
    [client, baseUrl],
  )
  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
}

export function useClient(): OneShotClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('useClient 必须在 <OneShotProvider> 内使用')
  return client
}
export function usePB(): PocketBase {
  return useClient().pb
}

export function useAuth<T extends RecordModel = UsersRecord>() {
  const pb = usePB()
  const [record, setRecord] = useState<T | null>(() => (pb.authStore.record as T | null))
  useEffect(() => pb.authStore.onChange(() => setRecord(pb.authStore.record as T | null)), [pb])
  const login = useCallback(
    (email: string, password: string) => pb.collection('users').authWithPassword(email, password),
    [pb],
  )
  const register = useCallback(
    (data: UsersRegisterInput) => pb.collection('users').create(data),
    [pb],
  )
  const logout = useCallback(() => pb.authStore.clear(), [pb])
  const refresh = useCallback(async () => { await pb.collection('users').authRefresh() }, [pb])
  return { user: record as T | null, token: pb.authStore.token, login, register, logout, refresh }
}

export function useRecords<T extends RecordModel = RecordModel>(collection: string, options: RecordListOptions = {}, page = 1, perPage = 20) {
  const pb = usePB()
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const optionsKey = JSON.stringify(options ?? {})
  const requestSeq = useRef(0)
  const reload = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const res = await pb.collection(collection).getList<T>(page, perPage, { ...JSON.parse(optionsKey), requestKey: null })
      if (seq !== requestSeq.current) return
      setItems(res.items)
      setTotal(res.totalItems)
      setError(null)
    } catch (err) {
      if (seq === requestSeq.current) setError(err)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [pb, collection, page, perPage, optionsKey])
  useEffect(() => {
    let alive = true
    let unsub: (() => void) | undefined
    reload()
    pb.collection(collection)
      .subscribe('*', () => { if (alive) reload() })
      .then((fn) => { if (!alive) fn(); else unsub = fn })
      .catch((err) => { if (alive) setError(err) })
    return () => {
      alive = false
      requestSeq.current++
      unsub?.()
    }
  }, [reload])
  return { items, total, loading, error, reload }
}
