// 真实图书管理系统全链路 e2e（副本级借还/上限/罚款/预约/报失/缴款/入库）
const PB = 'http://127.0.0.1:8095'
let passed = 0, failed = 0
const assert = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✅' : '❌'} ${name}${cond ? '' : '  ' + extra}`)
  cond ? passed++ : failed++
}
const j = async (method, path, body, token) => {
  const res = await fetch(PB + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const ts = Date.now()

// ---------- 状态重置（幂等）----------
{
  const su0 = await j('POST', '/api/collections/_superusers/auth-with-password', { identity: 'admin@demo.dev', password: 'demo123456' })
  const suTok = su0.data.token
  for (const coll of ['borrowings', 'reservations']) {
    const list = await j('GET', `/api/collections/${coll}/records?perPage=200`, undefined, suTok)
    for (const item of list.data.items ?? []) await j('DELETE', `/api/collections/${coll}/records/${item.id}`, undefined, suTok)
  }
  const copies = await j('GET', '/api/collections/copies/records?perPage=200', undefined, suTok)
  for (const c of copies.data.items ?? []) {
    if (c.status !== 'in_shelf') await j('PATCH', `/api/collections/copies/records/${c.id}`, { status: 'in_shelf' }, suTok)
  }
  const books = await j('GET', '/api/collections/books/records?perPage=200', undefined, suTok)
  for (const b of books.data.items ?? []) {
    if (!['9787536692930', '9787020042494', '9787111213826', '9787020002207'].includes(b.isbn)) {
      const cs = await j('GET', `/api/collections/copies/records?filter=` + encodeURIComponent(`book = "${b.id}"`), undefined, suTok)
      for (const c of cs.data.items ?? []) await j('DELETE', `/api/collections/copies/records/${c.id}`, undefined, suTok)
      await j('DELETE', `/api/collections/books/records/${b.id}`, undefined, suTok)
    }
  }
  const us = await j('GET', '/api/collections/users/records?perPage=200', undefined, suTok)
  for (const u of us.data.items ?? []) {
    if (Number(u.fines ?? 0) > 0) await j('PATCH', `/api/collections/users/records/${u.id}`, { fines: 0 }, suTok)
  }
}

// ---------- 准备 ----------
const su = await j('POST', '/api/collections/_superusers/auth-with-password', { identity: 'admin@demo.dev', password: 'demo123456' })
const suTok = su.data.token
const mkUser = async (tag) => {
  const email = `${tag}${ts}@lib.dev`
  const r = await j('POST', '/api/collections/users/records', { email, password: '1234567890', passwordConfirm: '1234567890' })
  const l = await j('POST', '/api/collections/users/auth-with-password', { identity: email, password: '1234567890' })
  return { email, id: r.data.id, token: l.data.token }
}
const A = await mkUser('a'), B = await mkUser('b'), C = await mkUser('c')
const books = await j('GET', '/api/collections/books/records?perPage=50')
const byIsbn = (i) => books.data.items.find(b => b.isbn === i)
const santi = byIsbn('9787536692930'), prince = byIsbn('9787020042494'), code = byIsbn('9787111213826'), hlm = byIsbn('9787020002207')
assert('基础数据：4 书目 8 副本（关系种子）', books.data.totalItems === 4
  && (await j('GET', '/api/collections/copies/records?perPage=50')).data.totalItems === 8)

// ---------- 副本级借阅 ----------
const b1 = await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, A.token)
assert('A 借三体：分配在架副本 + 条码', b1.status === 200 && /^C-/.test(b1.data.barcode), JSON.stringify(b1.data))
assert('剩余在架 = 2', b1.data.remainingOnShelf === 2)
const copiesAfter = await j('GET', `/api/collections/copies/records?filter=` + encodeURIComponent(`book = "${santi.id}" && status = "on_loan"`))
assert('副本状态转 on_loan（1 本）', copiesAfter.data.totalItems === 1)
const dup = await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, A.token)
assert('同书重复借被拒', dup.status === 400 && JSON.stringify(dup.data).includes('尚未归还'))
await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, B.token)

// ---------- 唯一副本借完 + 预约 ----------
const bCode = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, A.token)
assert('A 借走代码大全（唯一副本）', bCode.status === 200 && bCode.data.remainingOnShelf === 0)
const oos = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, B.token)
assert('B 借已借完的书被拒', oos.status === 400 && JSON.stringify(oos.data).includes('全部借出'))
const resvShelf = await j('POST', '/api/oneshot/library/reserve', { book: prince.id }, B.token)
assert('有在架副本时预约被拒', resvShelf.status === 400 && JSON.stringify(resvShelf.data).includes('在架'))
const r1 = await j('POST', '/api/oneshot/library/reserve', { book: code.id }, B.token)
assert('B 预约代码大全（队首 1）', r1.status === 200 && r1.data.queuePosition === 1)
const r2 = await j('POST', '/api/oneshot/library/reserve', { book: code.id }, C.token)
assert('C 也预约（队位 2）', r2.status === 200 && r2.data.queuePosition === 2)
const dupResv = await j('POST', '/api/oneshot/library/reserve', { book: code.id }, B.token)
assert('重复预约被拒', dupResv.status === 400)
const noRenew = await j('POST', '/api/oneshot/library/renew', { book: code.id }, A.token)
assert('有人排队时不可续借', noRenew.status === 400 && JSON.stringify(noRenew.data).includes('预约'))

// ---------- 预约优先 + 归还唤醒 ----------
const retCode = await j('POST', '/api/oneshot/library/returnBook', { copy: bCode.data.barcode }, A.token)
assert('A 按条码归还代码大全（唤醒预约）', retCode.status === 200 && retCode.data.reservedByOther === true, JSON.stringify(retCode.data))
const steal = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, A.token)
assert('非队首读者借被拒（预约优先）', steal.status === 400 && JSON.stringify(steal.data).includes('预约'))
const gotRsv = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, B.token)
assert('队首 B 成功借到（预约兑现）', gotRsv.status === 200, JSON.stringify(gotRsv.data))
const rsvB = await j('GET', `/api/collections/reservations/records?filter=` + encodeURIComponent(`member = "${B.id}" && book = "${code.id}"`), undefined, B.token)
assert('B 的预约转 fulfilled', rsvB.data.items?.[0]?.status === 'fulfilled')

// ---------- 借阅上限（maxBorrow=5）----------
await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, A.token)
await j('POST', '/api/oneshot/library/borrow', { book: hlm.id }, A.token)
// 超管直插借阅至 A 在借满 5 册（聚合多书在架副本；再借任何书应撞上限）
{
  const pool = await j('GET', `/api/collections/copies/records?filter=` + encodeURIComponent(`status = "in_shelf"`), undefined, suTok)
  const mine = await j('GET', `/api/collections/borrowings/records?filter=` + encodeURIComponent(`member = "${A.id}" && returnedAt = ""`), undefined, A.token)
  const need = 5 - mine.data.totalItems
  let inserted = 0
  for (const c of pool.data.items ?? []) {
    if (inserted >= need) break
    const owns = await j('GET', `/api/collections/borrowings/records?filter=` + encodeURIComponent(`copy = "${c.id}" && member = "${A.id}" && returnedAt = ""`), undefined, suTok)
    if (owns.data.totalItems > 0) continue
    await j('PATCH', `/api/collections/copies/records/${c.id}`, { status: 'on_loan' }, suTok)
    await j('POST', '/api/collections/borrowings/records', { copy: c.id, member: A.id, due: '2026-12-01 00:00:00' }, suTok)
    inserted++
  }
}
// 专测书：超管直建（A 未借过、有在架副本，绕开预约/借完干扰，只测上限本身）
const capBook = await j('POST', '/api/collections/books/records', { title: `上限专测${ts}`, isbn: `cap${String(ts).slice(-7)}`, category: '其他' }, suTok)
const capCopy = await j('POST', '/api/collections/copies/records', { book: capBook.data.id, barcode: `C-CAP-${String(ts).slice(-6)}`, status: 'in_shelf' }, suTok)
const cap = await j('POST', '/api/oneshot/library/borrow', { book: capBook.data.id }, A.token)
assert('达借阅上限（5 册）被拒', cap.status === 400 && JSON.stringify(cap.data).includes('上限'), JSON.stringify(cap.data))

// ---------- 逾期罚款 ----------
{
  const mine = await j('GET', `/api/collections/borrowings/records?filter=` + encodeURIComponent(`member = "${A.id}" && returnedAt = ""`), undefined, A.token)
  // 先还一册腾出额度（否则上限检查先挡，测不到逾期分支）
  await j('POST', '/api/oneshot/library/returnBook', { copy: mine.data.items[0].copy }, A.token)
  const mine2 = await j('GET', `/api/collections/borrowings/records?filter=` + encodeURIComponent(`member = "${A.id}" && returnedAt = ""`), undefined, A.token)
  const one = mine2.data.items[0]
  await j('PATCH', `/api/collections/borrowings/records/${one.id}`, { due: '2026-10-01 00:00:00' }, suTok)
  const blockedByOverdue = await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, A.token)
  assert('逾期未还不能再借', blockedByOverdue.status === 400 && JSON.stringify(blockedByOverdue.data).includes('逾期'), JSON.stringify(blockedByOverdue.data))
  const retO = await j('POST', '/api/oneshot/library/returnBook', { copy: one.copy }, A.token)
  assert('还逾期书结算罚款（>0）', retO.status === 200 && retO.data.fine > 0, JSON.stringify(retO.data))
  const meA = await j('GET', `/api/collections/users/records/${A.id}`, undefined, A.token)
  assert('欠款累加到读者账户', Number(meA.data.fines) === retO.data.fine, `fines=${meA.data.fines}`)
}

// ---------- 报失赔书 ----------
{
  const mine = await j('GET', `/api/collections/borrowings/records?filter=` + encodeURIComponent(`member = "${A.id}" && returnedAt = ""`), undefined, A.token)
  const one = mine.data.items[0]
  const lost = await j('POST', '/api/oneshot/library/reportLost', { borrowing: one.id }, A.token)
  assert('报失：副本转 lost + 赔款 30 元', lost.status === 200 && lost.data.charged === 30, JSON.stringify(lost.data))
  const cp = await j('GET', `/api/collections/copies/records/${one.copy}`, undefined, suTok)
  assert('副本状态 = lost', cp.data.status === 'lost')
  const meA = await j('GET', `/api/collections/users/records/${A.id}`, undefined, A.token)
  assert('赔款计入欠款', Number(meA.data.fines) >= 30, `fines=${meA.data.fines}`)
  const cannotBorrow = await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, A.token)
  assert('欠款 ≥10 禁止借书', cannotBorrow.status === 400 && JSON.stringify(cannotBorrow.data).includes('缴纳'))
}

// ---------- 管理员：缴款 / 入库 / 副本维护 ----------
const L = await mkUser('lib')
await j('PATCH', `/api/collections/users/records/${L.id}`, { role: 'librarian' }, suTok)
const lLogin = await j('POST', '/api/collections/users/auth-with-password', { identity: L.email, password: '1234567890' })
const lTok = lLogin.data.token
const settle = await j('POST', '/api/oneshot/library/settleFines', { member: A.id }, lTok)
assert('librarian 收缴 A 欠款', settle.status === 200 && settle.data.paid >= 30, JSON.stringify(settle.data))
const meA2 = await j('GET', `/api/collections/users/records/${A.id}`, undefined, A.token)
assert('A 欠款清零', Number(meA2.data.fines) === 0)
const readerSettle = await j('POST', '/api/oneshot/library/settleFines', { member: A.id }, B.token)
assert('读者收款被拒（403）', readerSettle.status === 403)

const added = await j('POST', '/api/oneshot/library/addBookWithCopies', {
  title: '人月神话', isbn: `9787302${String(ts).slice(-6)}`, author: 'Fred Brooks', publisher: '清华大学出版社', category: '技术', year: 2007, copies: 2, location: 'T-20',
}, lTok)
assert('librarian 一键入库（书目+2 副本）', added.status === 200 && added.data.barcodes.length === 2, JSON.stringify(added.data))
const newBorrow = await j('POST', '/api/oneshot/library/borrow', { book: added.data.bookId }, C.token)
assert('新书可立即被借', newBorrow.status === 200)
const repair = await j('POST', '/api/oneshot/library/setCopyStatus', { copy: newBorrow.data.barcode, status: 'repair' }, lTok)
assert('librarian 副本转维修', repair.status === 200)

// ---------- 统计 ----------
const stats = await j('GET', '/api/oneshot/library/stats', undefined, A.token)
assert('stats 数字合理', stats.data.titles === 6 && stats.data.totalCopies === 11 && stats.data.onLoan >= 5, JSON.stringify(stats.data))

console.log(`\n[真实图书馆 e2e] 通过 ${passed} · 失败 ${failed}`)
process.exitCode = failed ? 1 : 0
