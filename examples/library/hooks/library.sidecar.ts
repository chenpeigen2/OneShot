// library 的 sidecar action —— 真实图书馆业务逻辑（副本级借还、上限、罚款、预约）
// ctx: { service, action, auth: {id}|null, token, pbUrl, query, body }
// 读者动作以读者身份回调 PB；管理动作内部校验 librarian 角色

const DAY = 24 * 60 * 60 * 1000
const FINE_PER_DAY = 0.5   // 逾期罚款：0.5 元/天
const LOST_FINE = 30       // 遗失赔书：30 元/册
const MAX_RENEWALS = 2
const FINE_LIMIT = 10      // 欠款达到该值禁止再借

async function pbGet(ctx: any, path: string) {
  const res = await fetch(ctx.pbUrl + path, { headers: { Authorization: ctx.token } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data?.message ?? `PB ${res.status}`), { status: res.status === 400 ? 400 : 502 })
  return data
}
async function pbSend(ctx: any, method: string, path: string, body?: unknown) {
  const res = await fetch(ctx.pbUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: ctx.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data?.message ?? `PB ${res.status}`), { status: res.status === 400 ? 400 : 502 })
  return data
}
const q = (s: string) => encodeURIComponent(s)
const nowIso = () => new Date().toISOString()

/** 系统级写操作（service account，librarian 角色）：副本状态流转、罚款结算等
 *  读者无权直改、但业务动作必须执行的写操作；绝不能用于代替读者做业务决策。 */
async function sysSend(ctx: any, method: string, path: string, body?: unknown) {
  const res = await fetch(ctx.pbUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: ctx.systemToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(`系统操作失败：${data?.message ?? res.status}`), { status: 502 })
  return data
}

async function requireLibrarian(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const me = await pbGet(ctx, `/api/collections/users/records/${ctx.auth.id}`)
  if (me.role !== 'librarian') throw Object.assign(new Error('需要图书管理员权限'), { status: 403 })
  return me
}

/** 我的未还借阅列表 */
async function myActive(ctx: any) {
  const r = await pbGet(ctx, `/api/collections/borrowings/records?filter=${q(`member = "${ctx.auth.id}" && returnedAt = ""`)}&perPage=200`)
  return r.items ?? []
}
/** 某书目在架副本 */
async function shelfCopies(ctx: any, bookId: string) {
  const r = await pbGet(ctx, `/api/collections/copies/records?filter=${q(`book = "${bookId}" && status = "in_shelf"`)}&perPage=200`)
  return r.items ?? []
}
/** 某书目队首有效预约 */
async function headReservation(ctx: any, bookId: string) {
  const r = await pbGet(ctx, `/api/collections/reservations/records?filter=${q(`book = "${bookId}" && status = "active"`)}&sort=created&perPage=1`)
  return r.items?.[0] ?? null
}

/**
 * 借书：POST { book: 书目id, dueDays?: 14 }
 * 自动分配在架副本。校验：封禁 / 借阅上限 / 欠款 / 逾期未还 / 重复借 / 预约优先。
 */
export async function borrow(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const bookId = String(ctx.body?.book ?? '')
  const dueDays = Number(ctx.body?.dueDays ?? 14)
  if (!bookId) throw Object.assign(new Error('缺少 book'), { status: 400 })
  if (!(dueDays >= 1 && dueDays <= 90)) throw Object.assign(new Error('dueDays 需在 1-90'), { status: 400 })

  const me = await pbGet(ctx, `/api/collections/users/records/${ctx.auth.id}`)
  if (me.blocked) throw Object.assign(new Error('账号已被封禁'), { status: 403 })
  if (Number(me.fines ?? 0) >= FINE_LIMIT) {
    throw Object.assign(new Error(`欠款 ${me.fines} 元已达上限（${FINE_LIMIT} 元），请先到服务台缴纳`), { status: 400 })
  }

  const active = await myActive(ctx)
  if (active.length >= Number(me.maxBorrow ?? 5)) {
    throw Object.assign(new Error(`已达借阅上限（${me.maxBorrow} 册），请先归还`), { status: 400 })
  }
  const now = nowIso()
  const overdue = active.filter((b: any) => String(b.due) < now)
  if (overdue.length > 0) {
    throw Object.assign(new Error(`有 ${overdue.length} 册逾期未还，需先归还并缴罚款`), { status: 400 })
  }

  // 同一书目未还不可重复借
  const copiesOfBook = new Set(
    (await pbGet(ctx, `/api/collections/copies/records?filter=${q(`book = "${bookId}"`)}&perPage=200`).then((r: any) => r.items ?? []) as any[]).map((c: any) => c.id),
  )
  if (active.some((b: any) => copiesOfBook.has(b.copy))) {
    throw Object.assign(new Error('你已借了该书尚未归还'), { status: 400 })
  }

  // 预约优先：有队首预约且非本人 → 只有队首可借
  const head = await headReservation(ctx, bookId)
  if (head && head.member !== ctx.auth.id) {
    throw Object.assign(new Error('该书已被预约，预约读者优先'), { status: 400 })
  }

  // 分配在架副本
  const shelf = await shelfCopies(ctx, bookId)
  if (shelf.length === 0) throw Object.assign(new Error('该书已全部借出，可预约排队'), { status: 400 })
  const copy = shelf[0]
  await sysSend(ctx, 'PATCH', `/api/collections/copies/records/${copy.id}`, { status: 'on_loan' })

  const due = new Date(Date.now() + dueDays * DAY).toISOString()
  const record = await pbSend(ctx, 'POST', '/api/collections/borrowings/records', {
    copy: copy.id, member: ctx.auth.id, due,
  })

  // 本人预约兑现后置为 fulfilled
  if (head && head.member === ctx.auth.id) {
    await pbSend(ctx, 'PATCH', `/api/collections/reservations/records/${head.id}`, { status: 'fulfilled' })
  }

  const book = await pbGet(ctx, `/api/collections/books/records/${bookId}`)
  return {
    ok: true, borrowingId: record.id,
    book: book.title, barcode: copy.barcode, location: copy.location,
    due, remainingOnShelf: shelf.length - 1,
  }
}

/**
 * 还书：POST { copy: 副本id 或 barcode }（默认还我的最早未还）
 * 副本回架 + 逾期罚款结算（累加到读者 fines）+ 唤醒队首预约。
 */
export async function returnBook(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const copyFilter = String(ctx.body?.copy ?? '')
  const active = await myActive(ctx)
  let record: any
  if (copyFilter) {
    record = active.find((b: any) => b.copy === copyFilter || b.copyBarcode === copyFilter)
    if (!record) {
      // 按 barcode 查 copy id 再匹配
      const c = await pbGet(ctx, `/api/collections/copies/records?filter=${q(`barcode = "${copyFilter}"`)}&perPage=1`)
      const cid = c.items?.[0]?.id
      record = active.find((b: any) => b.copy === cid)
    }
  } else {
    record = active.sort((a: any, b: any) => String(a.due).localeCompare(String(b.due)))[0]
  }
  if (!record) throw Object.assign(new Error('没有匹配的未还借阅记录'), { status: 400 })

  const returnedAt = nowIso()
  const overdueMs = Date.parse(returnedAt) - Date.parse(record.due)
  const fine = overdueMs > 0 ? Math.ceil(overdueMs / DAY) * FINE_PER_DAY : 0

  const updated = await pbSend(ctx, 'PATCH', `/api/collections/borrowings/records/${record.id}`, { returnedAt, fine })
  await sysSend(ctx, 'PATCH', `/api/collections/copies/records/${record.copy}`, { status: 'in_shelf' })
  if (fine > 0) {
    const me = await pbGet(ctx, `/api/collections/users/records/${ctx.auth.id}`)
    await sysSend(ctx, 'PATCH', `/api/collections/users/records/${ctx.auth.id}`, { fines: Number(me.fines ?? 0) + fine })
  }

  // 唤醒队首预约（该副本书目）
  const copy = await pbGet(ctx, `/api/collections/copies/records/${record.copy}`)
  const head = await headReservation(ctx, copy.book)
  return {
    ok: true, borrowingId: updated.id, returnedAt, fine,
    overdue: fine > 0,
    reservedByOther: !!head && head.member !== ctx.auth.id,
  }
}

/**
 * 续借：POST { book: 书目id, days?: 14 } —— 未逾期、未达上限次数、该书无人排队。
 */
export async function renew(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const bookId = String(ctx.body?.book ?? '')
  const days = Number(ctx.body?.days ?? 14)
  if (!bookId) throw Object.assign(new Error('缺少 book'), { status: 400 })
  if (!(days >= 1 && days <= 30)) throw Object.assign(new Error('days 需在 1-30'), { status: 400 })

  const active = await myActive(ctx)
  const copiesOfBook = new Set(
    (await pbGet(ctx, `/api/collections/copies/records?filter=${q(`book = "${bookId}"`)}&perPage=200`).then((r: any) => r.items ?? []) as any[]).map((c: any) => c.id),
  )
  const record = active.find((b: any) => copiesOfBook.has(b.copy))
  if (!record) throw Object.assign(new Error('没有该书的未还借阅记录'), { status: 400 })
  if (Number(record.renewals ?? 0) >= MAX_RENEWALS) {
    throw Object.assign(new Error(`已达续借上限（${MAX_RENEWALS} 次）`), { status: 400 })
  }
  const now = nowIso()
  if (String(record.due) < now) throw Object.assign(new Error('已逾期不可续借，请先归还'), { status: 400 })
  // 有人排队预约则不允许续借（保护队列）
  const head = await headReservation(ctx, bookId)
  if (head && head.member !== ctx.auth.id) {
    throw Object.assign(new Error('该书已有读者预约排队，不可续借'), { status: 400 })
  }

  const newDue = new Date(Math.max(Date.now(), Date.parse(record.due)) + days * DAY).toISOString()
  const updated = await pbSend(ctx, 'PATCH', `/api/collections/borrowings/records/${record.id}`, {
    due: newDue, renewals: Number(record.renewals ?? 0) + 1,
  })
  return { ok: true, oldDue: record.due, newDue, renewals: updated.renewals }
}

/**
 * 预约：POST { book } —— 仅当全书无在架副本时排队；不可重复预约；上限 3 本。
 */
export async function reserve(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const bookId = String(ctx.body?.book ?? '')
  if (!bookId) throw Object.assign(new Error('缺少 book'), { status: 400 })
  if ((await shelfCopies(ctx, bookId)).length > 0) {
    throw Object.assign(new Error('该书有在架副本，可直接借阅'), { status: 400 })
  }
  const mine = await pbGet(ctx, `/api/collections/reservations/records?filter=${q(`member = "${ctx.auth.id}" && status = "active"`)}&perPage=50`)
  if ((mine.totalItems ?? 0) >= 3) throw Object.assign(new Error('预约上限 3 本'), { status: 400 })
  const dup = await pbGet(ctx, `/api/collections/reservations/records?filter=${q(`book = "${bookId}" && member = "${ctx.auth.id}" && status = "active"`)}&perPage=1`)
  if (dup.totalItems > 0) throw Object.assign(new Error('已预约该书'), { status: 400 })

  const r = await pbSend(ctx, 'POST', '/api/collections/reservations/records', { book: bookId, member: ctx.auth.id })
  const queue = await pbGet(ctx, `/api/collections/reservations/records?filter=${q(`book = "${bookId}" && status = "active"`)}&perPage=50`)
  return { ok: true, reservationId: r.id, queuePosition: (queue.items ?? []).findIndex((x: any) => x.id === r.id) + 1 }
}

/** 取消预约：POST { reservation } */
export async function cancelReservation(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const rid = String(ctx.body?.reservation ?? '')
  if (!rid) throw Object.assign(new Error('缺少 reservation'), { status: 400 })
  const r = await pbGet(ctx, `/api/collections/reservations/records/${rid}`)
  if (r.member !== ctx.auth.id) throw Object.assign(new Error('只能取消自己的预约'), { status: 403 })
  if (r.status !== 'active') throw Object.assign(new Error('该预约不在排队中'), { status: 400 })
  await pbSend(ctx, 'PATCH', `/api/collections/reservations/records/${rid}`, { status: 'cancelled' })
  return { ok: true }
}

/**
 * 报失赔书：POST { borrowing }（读者自行报失或 librarian 代办）
 * 副本转 lost、借阅按遗失结算（LOST_FINE 累加欠款）。
 */
export async function reportLost(ctx: any) {
  if (!ctx.auth?.id) throw Object.assign(new Error('需要登录'), { status: 401 })
  const bid = String(ctx.body?.borrowing ?? '')
  const rec = bid
    ? await pbGet(ctx, `/api/collections/borrowings/records/${bid}`)
    : (await myActive(ctx)).sort((a: any, b: any) => String(a.due).localeCompare(String(b.due)))[0]
  if (!rec) throw Object.assign(new Error('没有匹配的未还借阅记录'), { status: 400 })
  if (rec.returnedAt) throw Object.assign(new Error('该借阅已归还'), { status: 400 })
  if (rec.member !== ctx.auth.id) {
    // 代办需 librarian
    await requireLibrarian(ctx)
  }
  await sysSend(ctx, 'PATCH', `/api/collections/copies/records/${rec.copy}`, { status: 'lost' })
  await pbSend(ctx, 'PATCH', `/api/collections/borrowings/records/${rec.id}`, {
    returnedAt: nowIso(), fine: Number(rec.fine ?? 0) + LOST_FINE,
  })
  const member = await pbGet(ctx, `/api/collections/users/records/${rec.member}`)
  await sysSend(ctx, 'PATCH', `/api/collections/users/records/${rec.member}`, { fines: Number(member.fines ?? 0) + LOST_FINE })
  return { ok: true, borrowingId: rec.id, charged: LOST_FINE, note: '副本转遗失，赔书款已计入欠款' }
}

/** 副本状态维护（librarian）：POST { copy, status, location? } */
export async function setCopyStatus(ctx: any) {
  await requireLibrarian(ctx)
  const copyId = String(ctx.body?.copy ?? '')
  const status = String(ctx.body?.status ?? '')
  const valid = ['in_shelf', 'on_loan', 'lost', 'repair', 'withdrawn']
  if (!copyId || !valid.includes(status)) throw Object.assign(new Error(`copy 必填；status ∈ ${valid.join('/')}`), { status: 400 })
  // copy 支持 id 或 barcode
  let realId = copyId
  try {
    await pbGet(ctx, `/api/collections/copies/records/${copyId}`)
  } catch {
    const byBarcode = await pbGet(ctx, `/api/collections/copies/records?filter=${q(`barcode = "${copyId.toUpperCase()}"`)}&perPage=1`)
    realId = byBarcode.items?.[0]?.id
  }
  if (!realId) throw Object.assign(new Error('副本不存在'), { status: 400 })
  const patch: any = { status }
  if (ctx.body?.location !== undefined) patch.location = String(ctx.body.location)
  const updated = await pbSend(ctx, 'PATCH', `/api/collections/copies/records/${realId}`, patch)
  return { ok: true, copy: updated.id, status: updated.status }
}

/** 缴纳罚款（librarian 收款）：POST { member } —— 欠款清零 */
export async function settleFines(ctx: any) {
  await requireLibrarian(ctx)
  const memberId = String(ctx.body?.member ?? '')
  if (!memberId) throw Object.assign(new Error('缺少 member'), { status: 400 })
  const m = await pbGet(ctx, `/api/collections/users/records/${memberId}`)
  const paid = Number(m.fines ?? 0)
  await pbSend(ctx, 'PATCH', `/api/collections/users/records/${memberId}`, { fines: 0 })
  return { ok: true, member: memberId, paid }
}

/**
 * 入库（librarian）：POST { title, isbn, author?, publisher?, category, year?, copies: n, location?, summary? }
 * 书目 + N 个自动条码副本（BARCODE-<isbn后6>-<序号>）一次建齐。
 */
export async function addBookWithCopies(ctx: any) {
  const me = await requireLibrarian(ctx)
  const b = ctx.body ?? {}
  if (!b.title || !b.isbn || !b.category) throw Object.assign(new Error('title/isbn/category 必填'), { status: 400 })
  const n = Math.floor(Number(b.copies ?? 1))
  if (!(n >= 1 && n <= 50)) throw Object.assign(new Error('copies 需在 1-50'), { status: 400 })

  const book = await pbSend(ctx, 'POST', '/api/collections/books/records', {
    title: String(b.title).trim(), isbn: String(b.isbn).replace(/[-\s]/g, ''),
    author: b.author ?? '', publisher: b.publisher ?? '', category: b.category,
    year: b.year ? Number(b.year) : undefined, summary: b.summary ?? '',
  })
  const prefix = `C-${String(book.isbn).slice(-6).toUpperCase()}`
  const made: string[] = []
  for (let i = 1; i <= n; i++) {
    let barcode = `${prefix}-${String(i).padStart(3, '0')}`
    // 唯一索引兜底：撞码则递增序号
    let tryN = i
    for (;;) {
      const dup = await pbGet(ctx, `/api/collections/copies/records?filter=${q(`barcode = "${barcode}"`)}&perPage=1`)
      if (dup.totalItems === 0) break
      barcode = `${prefix}-${String(++tryN).padStart(3, '0')}`
    }
    await pbSend(ctx, 'POST', '/api/collections/copies/records', {
      book: book.id, barcode, status: 'in_shelf', location: b.location ?? '',
    })
    made.push(barcode)
  }
  return { ok: true, bookId: book.id, title: book.title, barcodes: made, by: me.email }
}

/** 提权/降权（librarian）：POST { member, role } */
export async function setRole(ctx: any) {
  await requireLibrarian(ctx)
  const member = String(ctx.body?.member ?? '')
  const role = String(ctx.body?.role ?? '')
  if (!member || !['reader', 'librarian'].includes(role)) {
    throw Object.assign(new Error('member 与 role（reader|librarian）必填'), { status: 400 })
  }
  const updated = await pbSend(ctx, 'PATCH', `/api/collections/users/records/${member}`, { role })
  return { ok: true, member: updated.id, role: updated.role }
}

/** 封禁/解封（librarian）：POST { member, banned }（应用层 blocked） */
export async function setBanned(ctx: any) {
  await requireLibrarian(ctx)
  const member = String(ctx.body?.member ?? '')
  const banned = !!ctx.body?.banned
  if (!member) throw Object.assign(new Error('member 必填'), { status: 400 })
  if (member === ctx.auth.id) throw Object.assign(new Error('不能封禁自己'), { status: 400 })
  const updated = await pbSend(ctx, 'PATCH', `/api/collections/users/records/${member}`, { blocked: banned })
  return { ok: true, member: updated.id, blocked: updated.blocked }
}
