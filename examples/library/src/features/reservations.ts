import { defineSidecarAction, withSidecarLocks } from '@oneshot/core'
import { decodeList, decodeReservation } from '../shared/records'
import { pbGet, q, esc, sysSend } from '../shared/pb'
import { activeBorrowings, allCopies, getBook, requireAuthId, requireMember, shelfCopies } from '../shared/queries'
import { fail, requiredString } from '../shared/values'

export const reserve = defineSidecarAction(
  (body) => ({ book: requiredString(body.book, 'book') }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    const bookId = ctx.body.book
    return withSidecarLocks([`member:${memberId}`, `book:${bookId}`], async () => {
      await requireMember(ctx)
      await getBook(ctx, bookId)
      if ((await shelfCopies(ctx, bookId)).length) fail('该书有在架副本，可直接借阅')
      const active = await activeBorrowings(ctx, memberId)
      const copies = await allCopies(ctx, bookId)
      const copyIds = new Set(copies.items.map((copy) => copy.id))
      if (active.some((record) => copyIds.has(record.copy))) fail('你已借阅该书，无需预约')
      const mine = await pbGet(
        ctx,
        `/api/collections/reservations/records?filter=${q(`member = "${memberId}" && status = "active"`)}&perPage=50`,
        decodeList(decodeReservation),
        true,
      )
      if (mine.totalItems >= 3) fail('预约上限 3 本')
      const duplicate = await pbGet(
        ctx,
        `/api/collections/reservations/records?filter=${q(`book = "${bookId}" && member = "${memberId}" && status = "active"`)}&perPage=1`,
        decodeList(decodeReservation),
        true,
      )
      if (duplicate.totalItems > 0) fail('已预约该书')

      const created = await sysSend(ctx, 'POST', '/api/collections/reservations/records', {
        book: bookId,
        member: memberId,
      }, decodeReservation)
      const queue = await pbGet(
        ctx,
        `/api/collections/reservations/records?filter=${q(`book = "${bookId}" && status = "active"`)}&sort=created,id&perPage=50`,
        decodeList(decodeReservation),
        true,
      )
      return {
        ok: true,
        reservationId: created.id,
        queuePosition: queue.items.findIndex((item) => item.id === created.id) + 1,
      }
    })
  },
)

export const cancelReservation = defineSidecarAction(
  (body) => ({ reservation: requiredString(body.reservation, 'reservation') }),
  async (ctx) => {
    const memberId = requireAuthId(ctx)
    await requireMember(ctx)
    const reservationId = ctx.body.reservation
    const reservation = await pbGet(ctx, `/api/collections/reservations/records/${reservationId}`, decodeReservation, true)
    if (reservation.member !== memberId) fail('只能取消自己的预约', 403)
    if (reservation.status !== 'active') fail('该预约不在排队中')
    await sysSend(ctx, 'PATCH', `/api/collections/reservations/records/${reservationId}`, { status: 'cancelled' }, decodeReservation)
    return { ok: true }
  },
)
