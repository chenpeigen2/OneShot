import { randomBytes } from 'node:crypto'
import { defineSidecarAction, withSidecarLocks } from '@oneshot/core'
import { BOOK_CATEGORIES, MANAGED_COPY_STATUSES, decodeBorrowing, decodeCopy, decodeList, type ManagedCopyStatus } from '../shared/records'
import { pbGet, q, esc, sysBatch, sysSend, type BatchRequest, type LibraryContext } from '../shared/pb'
import { findCopy, getBook, requireAuthId, requireLibrarian } from '../shared/queries'
import { enumValue, integerValue, optionalString, requiredString, fail } from '../shared/values'

const randomId = () => randomBytes(8).toString('hex').slice(0, 15)

function validateCopies(value: unknown): number {
  return integerValue(value, 'copies', 1, 1, 50)
}

async function makeCopyRequests(ctx: LibraryContext, bookId: string, isbn: string, count: number, location: string) {
  const prefix = `C-${isbn.slice(-6).toUpperCase()}`
  const existing = await pbGet(
    ctx,
    `/api/collections/copies/records?filter=${q(`barcode ~ "${esc(prefix)}"`)}&perPage=200`,
    decodeList(decodeCopy),
    true,
  )
  const used = new Set(existing.items.map((copy) => copy.barcode))
  const requests: BatchRequest[] = []
  const barcodes: string[] = []
  let sequence = 1
  while (requests.length < count) {
    const barcode = `${prefix}-${String(sequence++).padStart(3, '0')}`
    if (used.has(barcode)) continue
    used.add(barcode)
    barcodes.push(barcode)
    requests.push({
      method: 'POST',
      url: '/api/collections/copies/records',
      body: { book: bookId, barcode, status: 'in_shelf', location },
    })
  }
  return { requests, barcodes }
}

export const setCopyStatus = defineSidecarAction(
  (body) => ({
    copy: requiredString(body.copy, 'copy'),
    status: enumValue(body.status, 'status', MANAGED_COPY_STATUSES),
    location: body.location === undefined ? undefined : optionalString(body.location, 'location'),
  }),
  async (ctx) => {
    await requireLibrarian(ctx)
    const { copy: copyId, status, location } = ctx.body
    const copy = await findCopy(ctx, copyId)
    if (!copy) fail('副本不存在', 404)
    const active = await pbGet(
      ctx,
      `/api/collections/borrowings/records?filter=${q(`copy = "${copy.id}" && returnedAt = ""`)}&perPage=1`,
      decodeList(decodeBorrowing),
      true,
    )
    if (active.totalItems > 0) fail('该副本仍有未还借阅，请先归还或报失')
    const patch: { status: ManagedCopyStatus; location?: string } = { status }
    if (location !== undefined) patch.location = location
    const updated = await sysSend(ctx, 'PATCH', `/api/collections/copies/records/${copy.id}`, patch, decodeCopy)
    return { ok: true, copy: updated.id, status: updated.status, location: updated.location }
  },
)

export const addBookWithCopies = defineSidecarAction(
  (body) => ({
    title: requiredString(body.title, 'title'),
    isbn: requiredString(body.isbn, 'isbn'),
    category: enumValue(body.category, 'category', BOOK_CATEGORIES),
    author: optionalString(body.author, 'author'),
    publisher: optionalString(body.publisher, 'publisher'),
    year: body.year === undefined || body.year === '' ? undefined : integerValue(body.year, 'year', 0, 1000, 3000),
    copies: validateCopies(body.copies),
    location: optionalString(body.location, 'location'),
    summary: optionalString(body.summary, 'summary'),
  }),
  async (ctx) => {
    const me = await requireLibrarian(ctx)
    const input = ctx.body
    const isbn = input.isbn.replace(/[-\s]/g, '')
    const bookId = randomId()

    return withSidecarLocks(`isbn:${isbn}`, async () => {
      const copies = await makeCopyRequests(ctx, bookId, isbn, input.copies, input.location)
      await sysBatch(ctx, [
        {
          method: 'POST',
          url: '/api/collections/books/records',
          body: {
            id: bookId,
            title: input.title,
            isbn,
            author: input.author,
            publisher: input.publisher,
            category: input.category,
            year: input.year,
            summary: input.summary,
          },
        },
        ...copies.requests,
      ])
      return { ok: true, bookId, title: input.title, barcodes: copies.barcodes, by: me.email }
    })
  },
)

export const addCopies = defineSidecarAction(
  (body) => ({
    book: requiredString(body.book, 'book'),
    copies: validateCopies(body.copies),
    location: optionalString(body.location, 'location'),
  }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    await requireLibrarian(ctx)
    const { book: bookId, copies: count, location } = ctx.body
    const book = await getBook(ctx, bookId)
    return withSidecarLocks([`member:${memberId}`, `book:${bookId}`], async () => {
      const copies = await makeCopyRequests(ctx, bookId, book.isbn, count, location)
      await sysBatch(ctx, copies.requests)
      return { ok: true, bookId, barcodes: copies.barcodes }
    })
  },
)
