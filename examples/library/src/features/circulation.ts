import { defineSidecarAction, withSidecarLocks } from '@oneshot/core'
import { decodeBorrowing, decodeMember, type BorrowingRecord } from '../shared/records'
import { nowIso, pbGet, q, sysBatch, sysSend, type BatchRequest } from '../shared/pb'
import { activeBorrowings, allCopies, findCopy, getBook, getBorrowing, headReservation, requireAuthId, requireLibrarian, requireMember } from '../shared/queries'
import { fail, integerValue, optionalString, requiredString } from '../shared/values'

const DAY = 24 * 60 * 60 * 1000
const FINE_PER_DAY = 0.5
const LOST_FINE = 30
const MAX_RENEWALS = 2
const FINE_LIMIT = 10

export const borrow = defineSidecarAction(
  (body) => ({
    book: requiredString(body.book, 'book'),
    dueDays: integerValue(body.dueDays, 'dueDays', 14, 1, 90),
  }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    const { book: bookId, dueDays } = ctx.body
    return withSidecarLocks([`member:${memberId}`, `book:${bookId}`], async () => {
      const me = await requireMember(ctx)
      if (me.fines >= FINE_LIMIT) fail(`欠款 ${me.fines} 元已达上限（${FINE_LIMIT} 元），请先缴纳`)
      const active = await activeBorrowings(ctx, memberId)
      if (active.length >= me.maxBorrow) fail(`已达借阅上限（${me.maxBorrow} 册），请先归还`)
      const overdue = active.filter((record) => record.due < nowIso())
      if (overdue.length) fail(`有 ${overdue.length} 册逾期未还，需先归还并缴罚款`)

      const copies = await allCopies(ctx, bookId)
      if (!copies.totalItems) fail('书目不存在', 404)
      const copyIds = new Set(copies.items.map((copy) => copy.id))
      if (active.some((record) => copyIds.has(record.copy))) fail('你已借了该书尚未归还')

      const head = await headReservation(ctx, bookId)
      if (head && head.member !== memberId) fail('该书已被预约，预约读者优先')
      const shelf = copies.items.filter((copy) => copy.status === 'in_shelf')
      if (!shelf.length) fail('该书已全部借出，可预约排队')

      const copy = shelf[0]
      const due = new Date(Date.now() + dueDays * DAY).toISOString()
      const requests: BatchRequest[] = [
        { method: 'PATCH', url: `/api/collections/copies/records/${copy.id}`, body: { status: 'on_loan' } },
        { method: 'POST', url: '/api/collections/borrowings/records', body: { copy: copy.id, member: memberId, due } },
      ]
      if (head) requests.push({ method: 'PATCH', url: `/api/collections/reservations/records/${head.id}`, body: { status: 'fulfilled' } })
      const result = await sysBatch(ctx, requests)
      const created = decodeBorrowing(result[1]?.body)
      const book = await getBook(ctx, bookId)
      return {
        ok: true,
        borrowingId: created.id,
        book: book.title,
        barcode: copy.barcode,
        location: copy.location,
        due,
        remainingOnShelf: shelf.length - 1,
      }
    })
  },
)

export const returnBook = defineSidecarAction(
  (body) => ({
    borrowing: optionalString(body.borrowing, 'borrowing'),
    copy: optionalString(body.copy, 'copy'),
  }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    await requireMember(ctx)
    const { borrowing: borrowingId, copy: copyFilter } = ctx.body
    let record: BorrowingRecord | undefined
    if (borrowingId) {
      record = await getBorrowing(ctx, borrowingId)
    } else {
      const active = await activeBorrowings(ctx, memberId)
      if (copyFilter) {
        const copy = await findCopy(ctx, copyFilter)
        record = active.find((item) => item.copy === copy?.id)
      } else {
        record = active.sort((a, b) => a.due.localeCompare(b.due))[0]
      }
    }
    if (!record || record.returnedAt) fail('没有匹配的未还借阅记录')
    if (record.member !== memberId) await requireLibrarian(ctx)
    const copy = await findCopy(ctx, record.copy)
    if (!copy) fail('副本书目不存在', 404)

    return withSidecarLocks(`member:${record.member}`, async () => {
      const latest = await getBorrowing(ctx, record.id)
      if (latest.returnedAt) fail('该借阅已归还')
      const member = await pbGet(ctx, `/api/collections/users/records/${latest.member}`, decodeMember, true)
      const returnedAt = nowIso()
      const overdueMs = Date.parse(returnedAt) - Date.parse(latest.due)
      const fine = overdueMs > 0 ? Math.ceil(overdueMs / DAY) * FINE_PER_DAY : 0
      await sysBatch(ctx, [
        { method: 'PATCH', url: `/api/collections/borrowings/records/${latest.id}`, body: { returnedAt, fine } },
        { method: 'PATCH', url: `/api/collections/copies/records/${latest.copy}`, body: { status: 'in_shelf' } },
        ...(fine > 0 ? [{ method: 'PATCH' as const, url: `/api/collections/users/records/${latest.member}`, body: { fines: member.fines + fine } }] : []),
      ])
      const head = await headReservation(ctx, copy.book)
      return {
        ok: true,
        borrowingId: latest.id,
        returnedAt,
        fine,
        overdue: fine > 0,
        reservedByOther: !!head && head.member !== latest.member,
      }
    })
  },
)

export const renew = defineSidecarAction(
  (body) => ({
    book: requiredString(body.book, 'book'),
    days: integerValue(body.days, 'days', 14, 1, 30),
  }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    const { book: bookId, days } = ctx.body
    return withSidecarLocks(`member:${memberId}`, async () => {
      await requireMember(ctx)
      const active = await activeBorrowings(ctx, memberId)
      const copies = await allCopies(ctx, bookId)
      const copyIds = new Set(copies.items.map((copy) => copy.id))
      const record = active.find((item) => copyIds.has(item.copy))
      if (!record) fail('没有该书的未还借阅记录')
      if (record.renewals >= MAX_RENEWALS) fail(`已达续借上限（${MAX_RENEWALS} 次）`)
      if (record.due < nowIso()) fail('已逾期不可续借，请先归还')
      if (await headReservation(ctx, bookId)) fail('该书已有读者预约排队，不可续借')

      const newDue = new Date(Date.parse(record.due) + days * DAY).toISOString()
      const updated = await sysSend(ctx, 'PATCH', `/api/collections/borrowings/records/${record.id}`, {
        due: newDue,
        renewals: record.renewals + 1,
      }, decodeBorrowing)
      return { ok: true, oldDue: record.due, newDue, renewals: updated.renewals }
    })
  },
)

export const reportLost = defineSidecarAction(
  (body) => ({ borrowing: optionalString(body.borrowing, 'borrowing') }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    await requireMember(ctx)
    const rec = ctx.body.borrowing
      ? await getBorrowing(ctx, ctx.body.borrowing)
      : (await activeBorrowings(ctx, memberId)).sort((a, b) => a.due.localeCompare(b.due))[0]
    if (!rec || rec.returnedAt) fail('没有匹配的未还借阅记录')
    if (rec.member !== memberId) await requireLibrarian(ctx)

    return withSidecarLocks(`member:${rec.member}`, async () => {
      const latest = await getBorrowing(ctx, rec.id)
      if (latest.returnedAt) fail('该借阅已归还')
      const member = await pbGet(ctx, `/api/collections/users/records/${latest.member}`, decodeMember, true)
      await sysBatch(ctx, [
        { method: 'PATCH', url: `/api/collections/copies/records/${latest.copy}`, body: { status: 'lost' } },
        { method: 'PATCH', url: `/api/collections/borrowings/records/${latest.id}`, body: { returnedAt: nowIso(), fine: latest.fine + LOST_FINE } },
        { method: 'PATCH', url: `/api/collections/users/records/${latest.member}`, body: { fines: member.fines + LOST_FINE } },
      ])
      return { ok: true, borrowingId: latest.id, charged: LOST_FINE, note: '副本转遗失，赔书款已计入欠款' }
    })
  },
)
