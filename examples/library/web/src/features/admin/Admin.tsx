import { useCallback, useEffect, useState } from 'react'
import { useClient } from '../../api/react'
import { decodeStats } from '../../shared/decoding'
import { errorMessage } from '../../shared/errors'
import { PageTitle } from '../../shared/ui'
import type { LibraryStats, Notify } from '../../shared/types'
import { Circulation } from './Circulation'
import { Inventory } from './Inventory'
import { Members } from './Members'

export function Admin({ notify }: { notify: Notify }) {
  const api = useClient()
  const [tab, setTab] = useState('inventory')
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const loadStats = useCallback(() => {
    void api.books.stats()
      .then((value) => setStats(decodeStats(value)))
      .catch((error: unknown) => notify(errorMessage(error), true))
  }, [api, notify])
  useEffect(loadStats, [loadStats])
  return <section><PageTitle eyebrow="LIBRARIAN" title="馆藏工作台" description="管理书目、副本、流通与读者权限。" />
    <div className="stats-grid">{[['书目', stats?.titles], ['馆藏', stats?.totalCopies], ['在借', stats?.onLoan], ['逾期', stats?.overdue], ['有效预约', stats?.activeReservations]].map(([label, value]) => <div className="stat" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div>
    <nav className="subnav" aria-label="管理功能">{[['inventory', '馆藏管理'], ['circulation', '流通与预约'], ['members', '读者管理']].map(([key, label]) => <button className={tab === key ? 'active' : ''} key={key} onClick={() => { setTab(key); loadStats() }}>{label}</button>)}</nav>
    {tab === 'inventory' ? <Inventory notify={notify} /> : tab === 'circulation' ? <Circulation notify={notify} /> : <Members notify={notify} />}
  </section>
}
