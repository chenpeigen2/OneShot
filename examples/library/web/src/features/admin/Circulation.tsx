import { useClient, useRecords } from '../../api/react'
import type { BooksRecord, BorrowingsRecord, CopiesRecord, ReservationsRecord, UsersRecord } from '../../api/schema'
import { useAction } from '../../shared/actions'
import { decodeReturnResult } from '../../shared/decoding'
import { Tag } from '../../shared/ui'
import type { Notify } from '../../shared/types'

export function Circulation({ notify }: { notify: Notify }) {
  const api = useClient()
  const { items: borrowings } = useRecords<BorrowingsRecord>('borrowings', { sort: '-created' }, 1, 500)
  const { items: reservations } = useRecords<ReservationsRecord>('reservations', { sort: 'created' }, 1, 500)
  const { items: users } = useRecords<UsersRecord>('users', {}, 1, 200)
  const { items: books } = useRecords<BooksRecord>('books', {}, 1, 100)
  const { items: copies } = useRecords<CopiesRecord>('copies', {}, 1, 500)
  const { busy, run } = useAction(notify)
  const member = (id: string) => users.find((user) => user.id === id)?.email || id
  const bookOfCopy = (id: string) => books.find((book) => book.id === copies.find((copy) => copy.id === id)?.book)
  return <>
    <div className="panel"><div className="panel-heading"><h2>流通记录</h2><Tag>{borrowings.filter((item) => !item.returnedAt).length} 册未还</Tag></div><div className="table-wrap"><table><thead><tr><th>读者</th><th>图书 / 副本</th><th>应还</th><th>状态</th><th>操作</th></tr></thead><tbody>{borrowings.map((record) => {
      const overdue = !record.returnedAt && new Date(record.due) < new Date()
      return <tr key={record.id}><td>{member(record.member)}</td><td><strong>{bookOfCopy(record.copy)?.title}</strong><small>{copies.find((copy) => copy.id === record.copy)?.barcode}</small></td><td>{record.due.slice(0, 10)}</td><td>{record.returnedAt ? <Tag>已归还</Tag> : overdue ? <Tag tone="danger">逾期</Tag> : <Tag tone="success">在借</Tag>}</td><td>{!record.returnedAt && <button className="text-button" disabled={!!busy} onClick={() => void run(`admin-return-${record.id}`, () => api.borrowings.returnBook({ borrowing: record.id }), (value) => {
        const returned = decodeReturnResult(value)
        return returned.fine ? `代办归还，罚款 ${returned.fine} 元` : '代办归还成功'
      })}>代办归还</button>}</td></tr>
    })}</tbody></table></div></div>
    <div className="panel"><div className="panel-heading"><h2>预约队列</h2><Tag>{reservations.filter((item) => item.status === 'active').length} 个有效预约</Tag></div><div className="table-wrap"><table><thead><tr><th>图书</th><th>读者</th><th>申请时间</th><th>状态</th></tr></thead><tbody>{reservations.map((record) => <tr key={record.id}><td>{books.find((book) => book.id === record.book)?.title}</td><td>{member(record.member)}</td><td>{record.created.slice(0, 16).replace('T', ' ')}</td><td><Tag>{record.status === 'active' ? '排队中' : record.status === 'fulfilled' ? '已兑现' : '已取消'}</Tag></td></tr>)}</tbody></table></div></div>
  </>
}
