import { useAuth, useClient, useRecords } from '../../api/react'
import type { BooksRecord, BorrowingsRecord, CopiesRecord, ReservationsRecord, UsersRecord } from '../../api/schema'
import { useAction } from '../../shared/actions'
import { decodeRenewResult, decodeReturnResult } from '../../shared/decoding'
import { Empty, PageTitle, Tag } from '../../shared/ui'
import type { Notify } from '../../shared/types'

export function MyLibrary({ notify }: { notify: Notify }) {
  const api = useClient()
  const { user } = useAuth<UsersRecord>()
  const { items: borrowings, loading } = useRecords<BorrowingsRecord>('borrowings', { sort: '-created' }, 1, 200)
  const { items: copies } = useRecords<CopiesRecord>('copies', {}, 1, 500)
  const { items: books } = useRecords<BooksRecord>('books', {}, 1, 100)
  const { items: reservations } = useRecords<ReservationsRecord>('reservations', { sort: '-created' }, 1, 100)
  const { busy, run } = useAction(notify)
  const copyOf = (id: string) => copies.find((copy) => copy.id === id)
  const bookOf = (bookId: string) => books.find((book) => book.id === bookId)
  const active = borrowings.filter((item) => !item.returnedAt)

  return (
    <section>
      <PageTitle eyebrow="MY LIBRARY" title="我的书房" description={`当前在借 ${active.length}/${user?.maxBorrow || 5} 册，逾期图书归还后会计入罚款。`} />
      {Number(user?.fines) > 0 && <div className="fine-banner"><div><span>待缴欠款</span><strong>{user?.fines} 元</strong></div><p>逾期 0.5 元/天，欠款达到 10 元将暂停外借。请前往服务台缴纳。</p></div>}
      <div className="panel">
        <div className="panel-heading"><h2>借阅记录</h2><Tag>{active.length} 册在借</Tag></div>
        {loading ? <Empty>加载借阅记录…</Empty> : borrowings.length === 0 ? <Empty>还没有借阅记录，去目录挑一本书吧。</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>图书 / 副本</th><th>应还日期</th><th>状态</th><th>费用</th><th>操作</th></tr></thead><tbody>
            {borrowings.map((record) => {
              const copy = copyOf(record.copy)
              const book = copy ? bookOf(copy.book) : null
              const overdue = !record.returnedAt && new Date(record.due) < new Date()
              return <tr key={record.id}>
                <td><strong>{book?.title || '未知图书'}</strong><small>{copy?.barcode || record.copy}</small></td>
                <td>{record.due.slice(0, 10)}<small>续借 {record.renewals || 0}/2</small></td>
                <td>{record.returnedAt ? <Tag>已归还</Tag> : overdue ? <Tag tone="danger">已逾期</Tag> : <Tag tone="success">在借</Tag>}</td>
                <td>{record.fine ? `${record.fine} 元` : '—'}</td>
                <td>{!record.returnedAt && <div className="row-actions">
                  <button className="text-button" disabled={!!busy || overdue || record.renewals >= 2} onClick={() => void run(`renew-${record.id}`, () => api.books.renew({ book: copy?.book }), (result) => {
                    const renewed = decodeRenewResult(result)
                    return `已续借至 ${renewed.newDue.slice(0, 10)}`
                  })}>续借</button>
                  <button className="text-button" disabled={!!busy} onClick={() => void run(`return-${record.id}`, () => api.books.returnBook({ borrowing: record.id }), (result) => {
                    const returned = decodeReturnResult(result)
                    return returned.fine ? `已归还，罚款 ${returned.fine} 元` : '归还成功'
                  })}>归还</button>
                  <button className="text-button danger-text" disabled={!!busy} onClick={() => { if (confirm('确认报失？将产生 30 元赔书款。')) void run(`lost-${record.id}`, () => api.books.reportLost({ borrowing: record.id }), () => '已报失，赔书款已计入欠款') }}>报失</button>
                </div>}</td>
              </tr>
            })}
          </tbody></table></div>
        )}
      </div>
      <div className="panel">
        <div className="panel-heading"><h2>预约记录</h2><Tag>{reservations.filter((item) => item.status === 'active').length} 个排队中</Tag></div>
        {reservations.length === 0 ? <Empty>暂无预约</Empty> : <div className="reservation-list">{reservations.map((record) => (
          <div className="reservation-row" key={record.id}><div><strong>{bookOf(record.book)?.title || '未知图书'}</strong><small>{record.created.slice(0, 10)}</small></div><Tag tone={record.status === 'active' ? 'warning' : ''}>{record.status === 'active' ? '排队中' : record.status === 'fulfilled' ? '已兑现' : '已取消'}</Tag>{record.status === 'active' && <button className="text-button" disabled={!!busy} onClick={() => void run(`cancel-${record.id}`, () => api.books.cancelReservation({ reservation: record.id }), () => '预约已取消')}>取消预约</button>}</div>
        ))}</div>}
      </div>
    </section>
  )
}
