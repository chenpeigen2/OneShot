// library 的 JSVM hooks 与统计 action（oneshot publish 编译进 PB JSVM）

// 目录卫生：书名 trim、ISBN 去横线空格、条码大写（仅 books/copies）
export function beforeValidate(ctx: any) {
  if (ctx.coll === 'books') {
    const title = String(ctx.record.get('title') ?? '').trim()
    if (!title) throw new BadRequestError('title 不能为空')
    ctx.record.set('title', title)
    const isbn = String(ctx.record.get('isbn') ?? '').replace(/[-\s]/g, '')
    if (!isbn) throw new BadRequestError('isbn 不能为空')
    ctx.record.set('isbn', isbn)
  }
  if (ctx.coll === 'copies') {
    const barcode = String(ctx.record.get('barcode') ?? '').trim().toUpperCase()
    if (!barcode) throw new BadRequestError('barcode 不能为空')
    ctx.record.set('barcode', barcode)
  }
}

// GET /api/oneshot/library/stats —— 馆藏/流通/预约/罚款统计（只读）
export function stats(ctx: any) {
  const books = ctx.app.findRecordsByFilter('books', 'id != ""', '', -1, 0)
  const copies = ctx.app.findRecordsByFilter('copies', 'id != ""', '', -1, 0)
  const onShelf = ctx.app.findRecordsByFilter('copies', 'status = "in_shelf"', '', -1, 0)
  const now = new Date().toISOString()
  const active = ctx.app.findRecordsByFilter('borrowings', 'returnedAt = ""', '', -1, 0)
  const overdue = ctx.app.findRecordsByFilter('borrowings', `returnedAt = "" && due < "${now}"`, '', -1, 0)
  const reservations = ctx.app.findRecordsByFilter('reservations', 'status = "active"', '', -1, 0)
  const mineActive = ctx.auth ? ctx.app.findRecordsByFilter('borrowings', `returnedAt = "" && member = "${ctx.auth.id}"`, '', -1, 0).length : 0
  return {
    titles: books.length,
    totalCopies: copies.length,
    onShelf: onShelf.length,
    onLoan: active.length,
    overdue: overdue.length,
    activeReservations: reservations.length,
    myOnLoan: mineActive,
  }
}
