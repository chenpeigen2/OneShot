import { useState } from 'react'
import type { BooksRecord } from '../../api/schema'

export interface BookFormValue {
  title: string
  isbn: string
  author: string
  publisher: string
  category: BooksRecord['category']
  year: string
  copies: number
  location: string
  summary: string
}

export const EMPTY_BOOK: BookFormValue = { title: '', isbn: '', author: '', publisher: '', category: '技术', year: '', copies: 1, location: '', summary: '' }
const CATEGORIES: BooksRecord['category'][] = ['文学', '技术', '历史', '儿童', '其他']

export function BookForm({ initial, busy, onSubmit, onCancel }: { initial: BookFormValue; busy: boolean; onSubmit: (form: BookFormValue) => void; onCancel?: () => void }) {
  const [form, setForm] = useState(initial)
  const set = <K extends keyof BookFormValue>(key: K, value: BookFormValue[K]) => setForm((current) => ({ ...current, [key]: value }))
  return <form className="book-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form) }}>
    <div className="form-grid">
      <label>书名 *<input value={form.title} onChange={(event) => set('title', event.target.value)} required /></label>
      <label>ISBN *<input value={form.isbn} onChange={(event) => set('isbn', event.target.value)} required /></label>
      <label>作者<input value={form.author} onChange={(event) => set('author', event.target.value)} /></label>
      <label>出版社<input value={form.publisher} onChange={(event) => set('publisher', event.target.value)} /></label>
      <label>分类<select value={form.category} onChange={(event) => set('category', event.target.value as BooksRecord['category'])}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>出版年份<input type="number" min="1000" max="3000" value={form.year} onChange={(event) => set('year', event.target.value)} /></label>
      <label>首批副本<input type="number" min="1" max="50" value={form.copies} onChange={(event) => set('copies', Number(event.target.value))} disabled={!!onCancel} /></label>
      <label>架位<input value={form.location} onChange={(event) => set('location', event.target.value)} placeholder="如 A-01" /></label>
      <label className="wide">内容简介<textarea value={form.summary} onChange={(event) => set('summary', event.target.value)} maxLength={1000} /></label>
    </div>
    <div className="form-actions"><button disabled={busy || !form.title || !form.isbn}>{busy ? '保存中…' : onCancel ? '保存书目' : '书目与副本入库'}</button>{onCancel && <button type="button" className="secondary" onClick={onCancel}>取消</button>}</div>
  </form>
}
