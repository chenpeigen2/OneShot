import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PB = process.env.LIBRARY_PB_URL
const WEB = process.env.LIBRARY_WEB_URL
const EMAIL = process.env.LIBRARY_SU_EMAIL
const PASSWORD = process.env.LIBRARY_SU_PASSWORD
const ts = Date.now()
const password = '1234567890'
let browser
let page
const pageErrors = []

async function api(method, path, body, token) {
  const res = await fetch(PB + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(data)}`)
  return data
}

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true })
  } catch {
    return chromium.launch({ headless: true }).catch((error) => {
      throw new Error(`无法启动浏览器，请安装 Chrome 或执行 pnpm exec playwright install chromium：${error.message}`)
    })
  }
}

try {
  browser = await launch()
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  // 自建专用书目：浏览器套件与 API 套件共享实例，种子库存会被 API 用例借走，
  // 这里用超管建一本只属于浏览器用例的书，避免两个套件互相依赖库存。
  const su = await api('POST', '/api/collections/_superusers/auth-with-password', { identity: EMAIL, password: PASSWORD })
  const bookTitle = `浏览器专用书 ${ts}`
  const bookIsbn = `browser${String(ts).slice(-8)}`
  const book = await api('POST', '/api/collections/books/records', {
    title: bookTitle, isbn: bookIsbn, author: 'OneShot E2E', category: '技术', year: 2024, copies: 2,
  }, su.token)
  for (const barcode of [`B-${ts}-1`, `B-${ts}-2`]) {
    await api('POST', '/api/collections/copies/records', {
      book: book.id, barcode, status: 'in_shelf', location: 'E2E-01',
    }, su.token)
  }

  const readerEmail = `browser-reader-${ts}@library.test`
  await page.goto(WEB)
  await page.getByRole('heading', { name: '图书馆，重新开卷' }).waitFor()
  await page.getByLabel('邮箱', { exact: true }).fill(readerEmail)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '注册读者账号' }).click()
  await page.getByRole('heading', { name: '馆藏目录' }).waitFor()
  console.log('  ✅ 浏览器注册并登录读者')

  const card = page.locator('.book-card').filter({ hasText: bookTitle })
  await card.getByRole('button', { name: '借阅', exact: true }).click()
  await page.locator('.toast').filter({ hasText: `已借《${bookTitle}》` }).waitFor()
  await page.getByRole('button', { name: '我的书房', exact: true }).click()
  const loanRow = page.locator('tr').filter({ hasText: bookTitle }).filter({ hasText: '在借' })
  await loanRow.waitFor()
  console.log('  ✅ 共享登录态完成借书并显示在我的书房')

  await loanRow.getByRole('button', { name: '归还', exact: true }).click()
  await page.locator('.toast').filter({ hasText: '归还成功' }).waitFor()
  await page.getByText('已归还', { exact: true }).first().waitFor()
  console.log('  ✅ 浏览器归还图书并刷新记录')

  const adminEmail = `browser-admin-${ts}@library.test`
  const admin = await api('POST', '/api/collections/users/records', { email: adminEmail, password, passwordConfirm: password }, su.token)
  await api('PATCH', `/api/collections/users/records/${admin.id}`, { role: 'librarian' }, su.token)
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.getByLabel('邮箱', { exact: true }).fill(adminEmail)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '管理工作台', exact: true }).click()
  await page.getByRole('heading', { name: '馆藏工作台' }).waitFor()
  console.log('  ✅ 管理员登录并进入工作台')

  const isbn = `ui${String(ts).slice(-10)}`
  await page.getByLabel('书名 *', { exact: true }).fill(`浏览器验收 ${ts}`)
  await page.getByLabel('ISBN *', { exact: true }).fill(isbn)
  await page.getByLabel('作者', { exact: true }).fill('OneShot E2E')
  await page.getByRole('button', { name: '书目与副本入库' }).click()
  await page.locator('.toast').filter({ hasText: '个副本已入库' }).waitFor()
  await page.getByText(`浏览器验收 ${ts}`, { exact: true }).first().waitFor()
  const stored = await api('GET', `/api/collections/books/records?filter=${encodeURIComponent(`isbn = "${isbn}"`)}`, undefined, su.token)
  if (stored.totalItems !== 1) throw new Error('浏览器入库后未能从 PB 查到书目')
  console.log('  ✅ 浏览器完成书目与副本入库，PB 交叉验证通过')

  if (pageErrors.length) throw new Error(`页面存在未捕获异常：${pageErrors.join('；')}`)
  console.log('\n[library-browser] 通过 6 · 失败 0')
} catch (error) {
  mkdirSync(join(ROOT, '.oneshot/e2e'), { recursive: true })
  if (page) await page.screenshot({ path: join(ROOT, '.oneshot/e2e/browser-error.png'), fullPage: true }).catch(() => {})
  console.error(`\n[library-browser] 失败：${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  await browser?.close()
}
