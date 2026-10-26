import { useCallback, useState } from 'react'
import { useAuth } from '../api/react'
import type { UsersRecord } from '../api/schema'
import { errorMessage } from './errors'
import type { Notify } from './types'

export function useAction(notify: Notify) {
  const [busy, setBusy] = useState('')
  const { refresh } = useAuth<UsersRecord>()
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, success: (result: T) => string): Promise<T | null> => {
    setBusy(key)
    try {
      const result = await fn()
      notify(success(result))
      await refresh()
      return result
    } catch (error: unknown) {
      notify(errorMessage(error), true)
      return null
    } finally {
      setBusy('')
    }
  }, [notify, refresh])
  return { busy, run }
}
