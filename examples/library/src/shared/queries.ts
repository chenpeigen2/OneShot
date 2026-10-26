import { sidecarErrorStatus } from '@oneshot/core'
import { decodeBook, decodeBorrowing, decodeCopy, decodeList, decodeMember, decodeReservation, type BookRecord, type BorrowingRecord, type CopyRecord, type MemberRecord, type ReservationRecord } from './records'
import { pbGet, q, esc, type LibraryContext } from './pb'
import { fail } from './values'

const SERVICE_EMAIL = 'oneshot-service@system.local'

export function requireAuthId(ctx: LibraryContext): string {
  if (!ctx.auth?.id) fail('需要登录', 401)
  return ctx.auth.id
}

export async function requireMember(ctx: LibraryContext): Promise<MemberRecord> {
  const id = requireAuthId(ctx)
  const me = await pbGet(ctx, `/api/collections/users/records/${id}`, decodeMember, true)
  if (me.blocked) fail('账号已被封禁', 403)
  return me
}

export async function requireLibrarian(ctx: LibraryContext): Promise<MemberRecord> {
  const me = await requireMember(ctx)
  if (me.role !== 'librarian') fail('需要图书管理员权限', 403)
  return me
}

export async function getBook(ctx: LibraryContext, bookId: string): Promise<BookRecord> {
  return pbGet(ctx, `/api/collections/books/records/${encodeURIComponent(bookId)}`, decodeBook, true)
}

export async function getBorrowing(ctx: LibraryContext, borrowingId: string): Promise<BorrowingRecord> {
  return pbGet(ctx, `/api/collections/borrowings/records/${encodeURIComponent(borrowingId)}`, decodeBorrowing, true)
}

export async function activeBorrowings(ctx: LibraryContext, memberId: string): Promise<BorrowingRecord[]> {
  const result = await pbGet(
    ctx,
    `/api/collections/borrowings/records?filter=${q(`member = "${esc(memberId)}" && returnedAt = ""`)}&perPage=200`,
    decodeList(decodeBorrowing),
    true,
  )
  return result.items
}

export async function allCopies(ctx: LibraryContext, bookId: string) {
  return pbGet(
    ctx,
    `/api/collections/copies/records?filter=${q(`book = "${esc(bookId)}"`)}&perPage=200`,
    decodeList(decodeCopy),
    true,
  )
}

export async function shelfCopies(ctx: LibraryContext, bookId: string): Promise<CopyRecord[]> {
  const result = await pbGet(
    ctx,
    `/api/collections/copies/records?filter=${q(`book = "${esc(bookId)}" && status = "in_shelf"`)}&sort=created&perPage=200`,
    decodeList(decodeCopy),
    true,
  )
  return result.items
}

export async function headReservation(ctx: LibraryContext, bookId: string): Promise<ReservationRecord | null> {
  const result = await pbGet(
    ctx,
    `/api/collections/reservations/records?filter=${q(`book = "${esc(bookId)}" && status = "active"`)}&sort=created,id&perPage=1`,
    decodeList(decodeReservation),
    true,
  )
  return result.items[0] ?? null
}

export async function findCopy(ctx: LibraryContext, idOrBarcode: string): Promise<CopyRecord | null> {
  const byId = await pbGet(ctx, `/api/collections/copies/records/${encodeURIComponent(idOrBarcode)}`, decodeCopy, true)
    .catch((error: unknown) => {
      if (sidecarErrorStatus(error) !== 404) throw error
      return null
    })
  if (byId) return byId
  const result = await pbGet(
    ctx,
    `/api/collections/copies/records?filter=${q(`barcode = "${esc(idOrBarcode.trim().toUpperCase())}"`)}&perPage=1`,
    decodeList(decodeCopy),
    true,
  )
  return result.items[0] ?? null
}

export async function managedMember(ctx: LibraryContext, memberId: string): Promise<MemberRecord> {
  if (!memberId) fail('member 必填')
  const member = await pbGet(ctx, `/api/collections/users/records/${memberId}`, decodeMember, true)
  if (member.email === SERVICE_EMAIL) fail('系统服务账号不可管理', 403)
  return member
}
