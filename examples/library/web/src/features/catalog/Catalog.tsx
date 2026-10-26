import { useMemo, useState } from 'react'
import { useAuth, useClient, useRecords } from '../../api/react'
import type { BooksRecord, CopiesRecord, ReservationsRecord, UsersRecord } from '../../api/schema'
import { useAction } from '../../shared/actions'
import { decodeBorrowResult, decodeReservationResult } from '../../shared/decoding'
import { errorMessage } from '../../shared/errors'
import { Empty, PageTitle, Tag } from '../../shared/ui'
import type { Notify } from '../../shared/types'

const CATEGORIES = ['文学', '技术', '历史', '儿童', '其他']

export function Catalog({ notify }: { notify: Notify }) {
  const api = useClient()
  const { user } = useAuth<UsersRecord>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const { items: books, loading, error } = useRecords<BooksRecord>('books', { sort: 'title' }, 1, 100)
  const { items: copies } = useRecords<CopiesRecord>('copies', {}, 1, 500)
  const { items: reservations } = useRecords<ReservationsRecord>('reservations', { filter: 'status = "active"' }, 1, 100)
  const { busy, run } = useAction(notify)

  const availability = useMemo(() => {
    const result: Record<string, number> = {}
    copies.forEach((copy) => {
      if (copy.status === 'in_shelf') result[copy.book] = (result[copy.book] || 0) + 1
    })
    return result
  }, [copies])
  const shown = books.filter((book) => {
    const keyword = query.trim().toLowerCase()
    return (!keyword || [book.title, book.author, book.isbn].some((value) => value?.toLowerCase().includes(keyword))) && (!category || book.category === category)
  })

  return (
    <section>
      <PageTitle eyebrow="COLLECTION" title="馆藏目录" description="按书目查找馆藏，可借副本会实时更新。" />
      <div className="filters">
        <label className="search"><span className="sr-only">搜索馆藏</span><input placeholder="搜索书名、作者或 ISBN" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="按分类筛选" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">全部分类</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      {error ? <div className="inline-error">{errorMessage(error)}</div> : null}
      {loading ? <Empty>正在打开馆藏目录…</Empty> : shown.length === 0 ? <Empty>没有找到匹配的图书</Empty> : (
        <div className="book-grid">
          {shown.map((book) => {
            const count = availability[book.id] || 0
            const reserved = reservations.some((item) => item.book === book.id)
            const actionKey = `catalog-${book.id}`
            return (
              <article className="book-card" key={book.id}>
                <div className="book-top"><Tag>{book.category}</Tag><span>{book.year || '年份不详'}</span></div>
                <h2>{book.title}</h2>
                <p className="book-author">{book.author || '佚名'}</p>
                <p className="book-summary">{book.summary || '暂无内容简介。'}</p>
                <div className="book-meta"><span>{book.publisher || '出版社不详'}</span><span>ISBN {book.isbn}</span></div>
                <div className="book-footer">
                  <strong className={count ? 'available' : 'unavailable'}>{count ? `在架 ${count} 册` : '暂无在架副本'}</strong>
                  {count ? (
                    <button disabled={!!busy} onClick={() => void run(actionKey, () => api.books.borrow({ book: book.id }), (result) => {
                      const borrowed = decodeBorrowResult(result)
                      return `已借《${borrowed.book}》，条码 ${borrowed.barcode}`
                    })}>{busy === actionKey ? '借阅中…' : '借阅'}</button>
                  ) : (
                    <button className="secondary" disabled={!!busy || reserved} onClick={() => void run(actionKey, () => api.books.reserve({ book: book.id }), (result) => {
                      const reservation = decodeReservationResult(result)
                      return `预约成功，当前第 ${reservation.queuePosition} 位`
                    })}>{reserved ? '已预约' : busy === actionKey ? '预约中…' : '预约'}</button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      {!user && <Empty>登录后即可借阅</Empty>}
    </section>
  )
}
