import { useEffect, useState } from 'react'
import { useClient, useRecords } from '../../api/react'
import type { BooksRecord, CopiesRecord } from '../../api/schema'
import { useAction } from '../../shared/actions'
import { decodeAddBookResult, decodeAddCopiesResult } from '../../shared/decoding'
import { Tag } from '../../shared/ui'
import type { Notify } from '../../shared/types'
import { BookForm, EMPTY_BOOK, type BookFormValue } from './BookForm'

export function Inventory({ notify }: { notify: Notify }) {
  const api = useClient()
  const { items: books } = useRecords<BooksRecord>('books', { sort: 'title' }, 1, 100)
  const { items: copies } = useRecords<CopiesRecord>('copies', { sort: 'barcode' }, 1, 500)
  const [editing, setEditing] = useState<BooksRecord | null>(null)
  const [formVersion, setFormVersion] = useState(0)
  const { busy, run } = useAction(notify)
  const saveNew = async (form: BookFormValue) => {
    const result = await run('new-book', () => api.books.addBookWithCopies({ ...form, year: form.year ? Number(form.year) : undefined }), (value) => {
      const added = decodeAddBookResult(value)
      return `《${added.title}》及 ${added.barcodes.length} 个副本已入库`
    })
    if (result) setFormVersion((version) => version + 1)
  }
  return <>
    <div className="panel"><div className="panel-heading"><div><h2>新书入库</h2><p>一次创建书目和首批馆藏副本，条码自动生成。</p></div></div><BookForm key={formVersion} initial={EMPTY_BOOK} busy={busy === 'new-book'} onSubmit={(form) => void saveNew(form)} /></div>
    {editing && <div className="panel"><div className="panel-heading"><h2>编辑《{editing.title}》</h2></div><BookForm initial={{ title: editing.title, isbn: editing.isbn, author: editing.author, publisher: editing.publisher, category: editing.category, year: editing.year ? String(editing.year) : '', copies: 1, location: '', summary: editing.summary }} busy={busy === 'edit-book'} onCancel={() => setEditing(null)} onSubmit={(form) => void run('edit-book', () => api.books.update(editing.id, { title: form.title, isbn: form.isbn, author: form.author, publisher: form.publisher, category: form.category, year: form.year ? Number(form.year) : 0, summary: form.summary }), () => { setEditing(null); return '书目已更新' })} /></div>}
    <div className="panel"><div className="panel-heading"><h2>书目与副本</h2><Tag>{books.length} 种 / {copies.length} 册</Tag></div>
      <div className="table-wrap"><table><thead><tr><th>书目</th><th>馆藏</th><th>追加副本</th><th>操作</th></tr></thead><tbody>{books.map((book) => {
        const owned = copies.filter((copy) => copy.book === book.id)
        return <tr key={book.id}><td><strong>{book.title}</strong><small>{book.isbn} · {book.author}</small></td><td>{owned.length} 册<small>在架 {owned.filter((copy) => copy.status === 'in_shelf').length} 册</small></td><td><div className="inline-control"><input aria-label={`${book.title}追加副本数`} type="number" min="1" max="50" defaultValue={1} /><button className="text-button" disabled={!!busy} onClick={(event) => { const input = event.currentTarget.previousElementSibling as HTMLInputElement; void run(`copies-${book.id}`, () => api.books.addCopies({ book: book.id, copies: Number(input.value), location: '' }), (value) => {
          const added = decodeAddCopiesResult(value)
          return `已追加 ${added.barcodes.length} 个副本`
        }) }}>追加</button></div></td><td><button className="text-button" onClick={() => setEditing(book)}>编辑书目</button></td></tr>
      })}</tbody></table></div>
    </div>
    <CopiesPanel books={books} copies={copies} notify={notify} />
  </>
}

function CopiesPanel({ books, copies, notify }: { books: BooksRecord[]; copies: CopiesRecord[]; notify: Notify }) {
  const api = useClient()
  const { busy, run } = useAction(notify)
  return <div className="panel"><div className="panel-heading"><h2>副本维护</h2><p>借出状态由借阅流程自动维护，有未还记录的副本不能直接改状态。</p></div><div className="table-wrap"><table><thead><tr><th>条码</th><th>书目</th><th>架位</th><th>状态</th><th>操作</th></tr></thead><tbody>{copies.map((copy) => <CopyRow key={copy.id} copy={copy} title={books.find((book) => book.id === copy.book)?.title || ''} busy={busy} onSave={(status, location) => void run(`copy-${copy.id}`, () => api.copies.setCopyStatus({ copy: copy.id, status, location }), () => `${copy.barcode} 已更新`)} />)}</tbody></table></div></div>
}

function CopyRow({ copy, title, busy, onSave }: { copy: CopiesRecord; title: string; busy: string; onSave: (status: string, location: string) => void }) {
  const [status, setStatus] = useState(copy.status)
  const [location, setLocation] = useState(copy.location)
  useEffect(() => { setStatus(copy.status); setLocation(copy.location) }, [copy.status, copy.location])
  return <tr><td><code>{copy.barcode}</code></td><td>{title}</td><td><input className="compact-input" aria-label={`${copy.barcode}架位`} value={location} onChange={(event) => setLocation(event.target.value)} /></td><td>{copy.status === 'on_loan' ? <Tag tone="warning">借出中</Tag> : <select aria-label={`${copy.barcode}状态`} value={status} onChange={(event) => setStatus(event.target.value as CopiesRecord['status'])}><option value="in_shelf">在架</option><option value="repair">维修</option><option value="lost">遗失</option><option value="withdrawn">剔除</option></select>}</td><td>{copy.status !== 'on_loan' && <button className="text-button" disabled={!!busy} onClick={() => onSave(status, location)}>保存</button>}</td></tr>
}
