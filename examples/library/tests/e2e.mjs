const PB = process.env.LIBRARY_PB_URL || 'http://127.0.0.1:8095'
const SU_EMAIL = process.env.LIBRARY_SU_EMAIL || 'admin@demo.dev'
const SU_PASSWORD = process.env.LIBRARY_SU_PASSWORD || 'demo123456'
let passed = 0
let failed = 0
const assert = (name, condition, extra = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${name}${condition ? '' : `  ${extra}`}`)
  condition ? passed++ : failed++
}
const j = async (method, path, body, token) => {
  const res = await fetch(PB + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const ts = Date.now()
const su = await j('POST', '/api/collections/_superusers/auth-with-password', { identity: SU_EMAIL, password: SU_PASSWORD })
if (su.status !== 200) throw new Error(`超管登录失败：${JSON.stringify(su.data)}`)
const suToken = su.data.token

const mkUser = async (tag) => {
  const email = `${tag}-${ts}@library.test`
  const password = '1234567890'
  // 只提交账号信息：role/blocked/fines/maxBorrow 由服务端按默认值落库
  const registration = await j('POST', '/api/collections/users/records', { email, password, passwordConfirm: password })
  if (registration.status !== 200) throw new Error(`注册失败：${JSON.stringify(registration.data)}`)
  const login = await j('POST', '/api/collections/users/auth-with-password', { identity: email, password })
  return { id: registration.data.id, email, token: login.data.token, record: login.data.record }
}
const A = await mkUser('reader-a')
const B = await mkUser('reader-b')
const C = await mkUser('reader-c')
const books = await j('GET', '/api/collections/books/records?perPage=50')
const byIsbn = (isbn) => books.data.items.find((book) => book.isbn === isbn)
const santi = byIsbn('9787536692930')
const prince = byIsbn('9787020042494')
const code = byIsbn('9787111213826')
const hlm = byIsbn('9787020002207')
assert('关系种子创建 4 个书目和 8 个副本', books.data.totalItems === 4 && (await j('GET', '/api/collections/copies/records?perPage=50')).data.totalItems === 8)
assert('认证自定义字段使用安全默认值', A.record.role === 'reader' && A.record.maxBorrow === 5 && A.record.fines === 0 && A.record.blocked === false)
assert('公开注册只需账号密码（不暴露内部字段）', A.record.email.startsWith('reader-a-'))

const evilEmail = `evil-${ts}@library.test`
const evil = await j('POST', '/api/collections/users/records', { email: evilEmail, password: '1234567890', passwordConfirm: '1234567890', role: 'librarian' })
assert('公开注册不能提交管理员角色', evil.status === 400, JSON.stringify(evil.data))
const selfRole = await j('PATCH', `/api/collections/users/records/${A.id}`, { role: 'librarian' }, A.token)
const selfFines = await j('PATCH', `/api/collections/users/records/${A.id}`, { fines: 0, maxBorrow: 20, blocked: false }, A.token)
assert('读者不能自行提权', selfRole.status === 404, `status=${selfRole.status}`)
assert('读者不能修改借阅上限等受管字段', selfFines.status === 404, `status=${selfFines.status}`)
// 单独提交 fines=0：旧规则下会清零已有欠款（越权），新规则必须拒绝
await j('PATCH', `/api/collections/users/records/${A.id}`, { fines: 30 }, suToken)
const selfClear = await j('PATCH', `/api/collections/users/records/${A.id}`, { fines: 0 }, A.token)
const aAfter = await j('GET', `/api/collections/users/records/${A.id}`, undefined, suToken)
assert('读者不能自行清零欠款', selfClear.status === 404 && Number(aAfter.data.fines) === 30, `status=${selfClear.status} fines=${aAfter.data?.fines}`)
// 未提交受管字段时，只改姓名是允许的
const selfName = await j('PATCH', `/api/collections/users/records/${A.id}`, { name: '改名读者' }, A.token)
assert('读者可修改自己的非受管字段', selfName.status === 200 && selfName.data.name === '改名读者', `status=${selfName.status}`)
await j('PATCH', `/api/collections/users/records/${A.id}`, { fines: 0 }, suToken)

const b1 = await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, A.token)
assert('借书自动分配副本和条码', b1.status === 200 && /^C-/.test(b1.data.barcode), JSON.stringify(b1.data))
assert('副本与借阅记录在同一事务更新', b1.data.remainingOnShelf === 2 && (await j('GET', `/api/collections/copies/records?filter=${encodeURIComponent(`barcode = "${b1.data.barcode}" && status = "on_loan"`)}`)).data.totalItems === 1)
const duplicate = await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, A.token)
assert('同一书目未还时不能重复借', duplicate.status === 400)
await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, B.token)
const otherView = await j('GET', `/api/collections/borrowings/records/${b1.data.borrowingId}`, undefined, B.token)
const otherList = await j('GET', '/api/collections/borrowings/records?perPage=200', undefined, B.token)
assert('其他读者不能查看我的借阅单', otherView.status === 404)
assert('借阅列表只返回本人记录', otherList.data.items.every((item) => item.member === B.id))
const directBorrow = await j('POST', '/api/collections/borrowings/records', { copy: 'fake', member: A.id, due: new Date().toISOString() }, A.token)
const directReservation = await j('POST', '/api/collections/reservations/records', { book: santi.id, member: A.id }, A.token)
assert('不能绕过 action 直接创建借阅和预约', [400, 403, 404].includes(directBorrow.status) && [400, 403, 404].includes(directReservation.status))
const directReturn = await j('PATCH', `/api/collections/borrowings/records/${b1.data.borrowingId}`, { returnedAt: new Date().toISOString() }, A.token)
assert('不能绕过 action 直接归还', directReturn.status === 403 || directReturn.status === 404)

const borrowedCode = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, A.token)
assert('唯一副本可以被借走', borrowedCode.status === 200 && borrowedCode.data.remainingOnShelf === 0)
const outOfStock = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, B.token)
assert('借完后其他读者不能借', outOfStock.status === 400)
const reserveOnShelf = await j('POST', '/api/oneshot/library/reserve', { book: prince.id }, B.token)
assert('有在架副本时不能预约', reserveOnShelf.status === 400)
const r1 = await j('POST', '/api/oneshot/library/reserve', { book: code.id }, B.token)
const r2 = await j('POST', '/api/oneshot/library/reserve', { book: code.id }, C.token)
assert('预约按先后顺序排队', r1.data.queuePosition === 1 && r2.data.queuePosition === 2, JSON.stringify({ r1: r1.data, r2: r2.data }))
const duplicateReservation = await j('POST', '/api/oneshot/library/reserve', { book: code.id }, B.token)
assert('活动预约不能重复创建', duplicateReservation.status === 400)
const blockedRenew = await j('POST', '/api/oneshot/library/renew', { book: code.id }, A.token)
assert('有人排队时不能续借', blockedRenew.status === 400)
const returnedCode = await j('POST', '/api/oneshot/library/returnBook', { copy: borrowedCode.data.barcode }, A.token)
assert('按条码归还并唤醒预约', returnedCode.status === 200 && returnedCode.data.reservedByOther === true, JSON.stringify(returnedCode.data))
const steal = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, A.token)
assert('非队首读者不能抢借', steal.status === 400)
const fulfilled = await j('POST', '/api/oneshot/library/borrow', { book: code.id }, B.token)
assert('队首读者借书并兑现预约', fulfilled.status === 200 && (await j('GET', `/api/collections/reservations/records/${r1.data.reservationId}`, undefined, B.token)).data.status === 'fulfilled')

const renewable = await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, A.token)
const renewed = await j('POST', '/api/oneshot/library/renew', { book: prince.id, days: 7 }, A.token)
assert('无预约且未逾期时可以续借', renewed.status === 200 && renewed.data.renewals === 1 && Date.parse(renewed.data.newDue) > Date.parse(renewable.data.due))
const invalidDays = await j('POST', '/api/oneshot/library/renew', { book: prince.id, days: 1.5 }, A.token)
assert('续借天数必须是整数', invalidDays.status === 400)

await j('PATCH', `/api/collections/users/records/${C.id}`, { maxBorrow: 1 }, suToken)
const capFirst = await j('POST', '/api/oneshot/library/borrow', { book: hlm.id }, C.token)
const capSecond = await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, C.token)
assert('读者自定义借阅上限生效', capFirst.status === 200 && capSecond.status === 400 && JSON.stringify(capSecond.data).includes('上限'))

const D = await mkUser('overdue')
await j('POST', '/api/oneshot/library/borrow', { book: hlm.id }, D.token)
const dActive = await j('GET', `/api/collections/borrowings/records?filter=${encodeURIComponent(`member = "${D.id}" && returnedAt = ""`)}`, undefined, D.token)
const overdueRecord = dActive.data.items[0]
await j('PATCH', `/api/collections/borrowings/records/${overdueRecord.id}`, { due: new Date(Date.now() - 2 * 864e5).toISOString() }, suToken)
const blockedByOverdue = await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, D.token)
assert('逾期未还不能继续借书', blockedByOverdue.status === 400)
const returnedOverdue = await j('POST', '/api/oneshot/library/returnBook', { borrowing: overdueRecord.id }, D.token)
assert('逾期归还按天结算罚款', returnedOverdue.status === 200 && returnedOverdue.data.fine > 0, JSON.stringify(returnedOverdue.data))
const dAfterFine = await j('GET', `/api/collections/users/records/${D.id}`, undefined, D.token)
assert('罚款同步到读者账户', Number(dAfterFine.data.fines) === returnedOverdue.data.fine)
await j('POST', '/api/oneshot/library/borrow', { book: hlm.id }, D.token)
const dLostList = await j('GET', `/api/collections/borrowings/records?filter=${encodeURIComponent(`member = "${D.id}" && returnedAt = ""`)}`, undefined, D.token)
const lost = await j('POST', '/api/oneshot/library/reportLost', { borrowing: dLostList.data.items[0].id }, D.token)
assert('报失产生 30 元赔书款', lost.status === 200 && lost.data.charged === 30)
const blockedByFine = await j('POST', '/api/oneshot/library/borrow', { book: prince.id }, D.token)
assert('欠款达到 10 元后暂停外借', blockedByFine.status === 400)

const L = await mkUser('librarian')
await j('PATCH', `/api/collections/users/records/${L.id}`, { role: 'librarian' }, suToken)
const lLogin = await j('POST', '/api/collections/users/auth-with-password', { identity: L.email, password: '1234567890' })
L.token = lLogin.data.token
const readerSettle = await j('POST', '/api/oneshot/library/settleFines', { member: D.id }, A.token)
assert('普通读者不能收款', readerSettle.status === 403)
const settled = await j('POST', '/api/oneshot/library/settleFines', { member: D.id }, L.token)
assert('管理员收款后欠款清零', settled.status === 200 && settled.data.paid >= 30 && Number((await j('GET', `/api/collections/users/records/${D.id}`, undefined, D.token)).data.fines) === 0)

const added = await j('POST', '/api/oneshot/library/addBookWithCopies', { title: `人月神话 ${ts}`, isbn: `9787302${String(ts).slice(-6)}`, author: 'Fred Brooks', category: '技术', year: 2007, copies: 2, location: 'T-20' }, L.token)
assert('新书和首批副本原子入库', added.status === 200 && added.data.barcodes.length === 2, JSON.stringify(added.data))
const extra = await j('POST', '/api/oneshot/library/addCopies', { book: added.data.bookId, copies: 2, location: 'T-21' }, L.token)
assert('已有书目可以追加副本', extra.status === 200 && extra.data.barcodes.length === 2 && !extra.data.barcodes.some((code) => added.data.barcodes.includes(code)))
const addedBorrow = await j('POST', '/api/oneshot/library/borrow', { book: added.data.bookId }, B.token)
const invalidStatus = await j('POST', '/api/oneshot/library/setCopyStatus', { copy: addedBorrow.data.barcode, status: 'repair' }, L.token)
assert('有未还借阅的副本不能直接转维修', invalidStatus.status === 400)
const fakeLoan = await j('POST', '/api/oneshot/library/setCopyStatus', { copy: added.data.barcodes[1], status: 'on_loan' }, L.token)
assert('管理员也不能无借阅记录手工转借出', fakeLoan.status === 400)
const adminReturn = await j('POST', '/api/oneshot/library/returnBook', { borrowing: addedBorrow.data.borrowingId }, L.token)
const repaired = await j('POST', '/api/oneshot/library/setCopyStatus', { copy: addedBorrow.data.barcode, status: 'repair', location: 'LAB-1' }, L.token)
assert('管理员可代办归还并维护副本', adminReturn.status === 200 && repaired.status === 200 && repaired.data.location === 'LAB-1')

const concurrentBook = await j('POST', '/api/oneshot/library/addBookWithCopies', { title: `并发测试 ${ts}`, isbn: `con${String(ts).slice(-10)}`, category: '其他', copies: 1 }, L.token)
const E = await mkUser('concurrent-e')
const F = await mkUser('concurrent-f')
const race = await Promise.all([E, F].map((user) => j('POST', '/api/oneshot/library/borrow', { book: concurrentBook.data.bookId }, user.token)))
const raceLoans = await j('GET', `/api/collections/borrowings/records?filter=${encodeURIComponent(`copy.book = "${concurrentBook.data.bookId}" && returnedAt = ""`)}&perPage=10`, undefined, suToken)
assert('并发借最后一册只有一个成功', race.filter((result) => result.status === 200).length === 1, JSON.stringify(race))
assert('并发后只有一条有效借阅', raceLoans.data.totalItems === 1, JSON.stringify(raceLoans.data))
const G = await mkUser('concurrent-limit')
await j('PATCH', `/api/collections/users/records/${G.id}`, { maxBorrow: 1 }, suToken)
const limitRace = await Promise.all([santi, prince].map((book) => j('POST', '/api/oneshot/library/borrow', { book: book.id }, G.token)))
const gLoans = await j('GET', `/api/collections/borrowings/records?filter=${encodeURIComponent(`member = "${G.id}" && returnedAt = ""`)}`, undefined, G.token)
assert('同一读者并发借不同书也不能突破上限', limitRace.filter((result) => result.status === 200).length === 1 && gLoans.data.totalItems === 1, JSON.stringify(limitRace))
const banned = await j('POST', '/api/oneshot/library/setBanned', { member: E.id, banned: true }, L.token)
const bannedAction = await j('POST', '/api/oneshot/library/borrow', { book: santi.id }, E.token)
assert('封禁账号不能执行读者动作', banned.status === 200 && bannedAction.status === 403)
const promoted = await j('POST', '/api/oneshot/library/setRole', { member: F.id, role: 'librarian' }, L.token)
assert('管理员可以分配角色', promoted.status === 200 && promoted.data.role === 'librarian')

const stats = await j('GET', '/api/oneshot/library/stats', undefined, A.token)
assert('统计覆盖馆藏、流通、逾期和预约', stats.status === 200 && stats.data.titles >= 6 && stats.data.totalCopies >= 13 && Number.isInteger(stats.data.activeReservations), JSON.stringify(stats.data))
console.log(`\n[library-api] 通过 ${passed} · 失败 ${failed}`)
process.exitCode = failed ? 1 : 0
