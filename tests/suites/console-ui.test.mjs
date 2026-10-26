// 套件 8：console 构建产物浏览器 E2E（R3；排最后——污染面最大：真实写回 manifest-project、增删主实例备份）
// playwright 库模式（不用 @playwright/test runner）：单 context 单 page 顺序跑五条路径。
// 纪律：禁 waitForTimeout 固定睡眠（locator 自动等待 / waitFor / 事件等待）；失败截图 + console 缓冲落 artifacts。
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PB, CTRL, assert, summary, j, superuserLogin, makeUser } from '../helpers.mjs'

const TMP = process.env.TEST_TMP || 'tests/.tmp'
const FIXTURE = process.env.TEST_FIXTURE_DIR || 'tests/.tmp/project'
const CORE = process.env.TEST_CORE_DIR
const artifactsDir = join(TMP, 'console-ui-artifacts')
mkdirSync(artifactsDir, { recursive: true })

// ---------- arrange via API：token、manifest、期望 hash、播种记录 ----------
const suToken = await superuserLogin(PB)
const manifestRes = await j(CTRL, 'GET', '/api/manifest', undefined, suToken)
if (!manifestRes.data?.config) throw new Error(`arrange 失败：GET /api/manifest 无 config（${JSON.stringify(manifestRes.data)}）`)
const config = manifestRes.data.config
const manifestPath = manifestRes.data.path

// 幂等 POST 回写（no-op diff）：保证 oneshot_meta 最新记录与当前 config 一致 → 仪表盘 hash 可确定性计算
const repost = await j(CTRL, 'POST', '/api/manifest', { config }, suToken)
if (!repost.data?.report) throw new Error(`arrange 失败：幂等 POST /api/manifest 未成功（${JSON.stringify(repost.data)}）`)
// 清掉 pre-existing .bak，让编辑器场景的 .bak 断言指向本次真实写回
rmSync(`${manifestPath}.bak`, { force: true })

const { buildSnapshot, snapshotHash } = await import(pathToFileURL(join(CORE, 'dist', 'index.js')).href)
const expectedHash = snapshotHash(buildSnapshot(config))

const svcName = config.services.find((s) => s.collections?.tasks)?.name
if (!svcName) throw new Error('arrange 失败：当前 manifest 没有 tasks collection 所在服务')
const collName = 'tasks'
const ts = Date.now()
const uniqueField = `e2e_ui_${ts}`
const seedTitle = `e2e_ui_seed_${ts}`
const backupName = `e2e_ui_${ts}`

const owner = await makeUser()
const seeded = await j(PB, 'POST', '/api/collections/tasks/records', { title: seedTitle, owner: owner.id }, suToken)
if (seeded.status !== 200) throw new Error(`arrange 失败：播种记录被拒（${JSON.stringify(seeded.data)}）`)
const seededId = seeded.data.id

// ---------- AC-1 环境就绪：chromium（缺浏览器 = 失败 + 安装指引，不允许静默 skip） ----------
let browser = null
try {
  const { chromium } = await import('playwright')
  // 优先复用系统 Chrome（channel: 'chrome'， contributor 零下载）；
  // 没有系统 Chrome 时回落到 playwright 自带 chromium（需一次性 install）
  try {
    browser = await chromium.launch({ channel: 'chrome' })
  } catch {
    browser = await chromium.launch()
  }
  assert('环境: 浏览器启动成功（系统 Chrome 优先，否则自带 chromium）', true)
} catch (err) {
  assert('环境: 浏览器启动成功（系统 Chrome 优先，否则自带 chromium）', false,
    `浏览器不可用：本地 Chrome 与 playwright chromium 均未就绪。装系统 Chrome，或一次性运行 pnpm exec playwright install chromium（CI 已含 --with-deps 安装 step）。原因：${err?.message ?? err}`)
}
const rootHtml = await fetch(CTRL + '/').then((r) => r.text())
assert('环境: TEST_CTRL 托管构建产物（SPA root 节点存在）', rootHtml.includes('id="root"'), rootHtml.slice(0, 80))

if (!browser) {
  summary('console-ui')
  process.exit() // exitCode 已由 summary 置 1
}

// ---------- 浏览器会话：单 context 单 page ----------
const context = await browser.newContext({ acceptDownloads: true })
const page = await context.newPage()
const pageErrors = []
const consoleErrors = [] // 仅 error 级；排除浏览器对预期 4xx 的 "Failed to load resource" 网络日志（非应用缺陷）
page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)))
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) consoleErrors.push(m.text()) })

let step = 'init'
const dumpArtifacts = async (reason) => {
  try {
    await page.screenshot({ path: join(artifactsDir, `failure-${Date.now()}.png`), fullPage: true })
  } catch {}
  try {
    writeFileSync(join(artifactsDir, `page-log-${Date.now()}.json`),
      JSON.stringify({ reason, step, url: page.url(), pageErrors, consoleErrors }, null, 2))
  } catch {}
}

try {
  // ---------- AC-2 登录流（PB 地址显式 fill，不依赖 localStorage 默认值） ----------
  step = 'AC-2 登录'
  await page.goto(CTRL + '/', { waitUntil: 'domcontentloaded' })
  const loginTitle = page.getByText('OneShot 控制台')
  const emailInput = page.locator('input[type="email"]')
  await Promise.all([loginTitle.waitFor({ state: 'visible', timeout: 10000 }), emailInput.waitFor({ state: 'visible', timeout: 10000 })])
  assert('登录: 表单可见（OneShot 控制台标题 + 邮箱输入框）', await loginTitle.isVisible() && await emailInput.isVisible())

  await page.locator('form input').first().fill(PB) // 地址输入框（第一个无 type 的 input）
  await emailInput.fill('admin@example.com')
  await page.locator('input[type="password"]').fill('definitely-wrong')
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await page.getByText(/Failed to authenticate|登录失败/).waitFor({ state: 'visible', timeout: 10000 })
  const dashboardLeaked = await page.getByText('发布状态').count()
  assert('登录: 错误密码 → 错误横幅出现且仪表盘未出现', dashboardLeaked === 0)

  await page.locator('input[type="password"]').fill('oneshot123')
  await page.getByRole('button', { name: '连接', exact: true }).click()

  // ---------- AC-3 仪表盘 ----------
  step = 'AC-3 仪表盘'
  await page.getByText('发布状态').waitFor({ state: 'visible', timeout: 15000 })
  await page.getByText('e2e-fixture', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
  const projectVisible = await page.getByText('e2e-fixture', { exact: true }).isVisible()
  assert('登录: 正确凭据 → 仪表盘出现且项目名为 e2e-fixture', projectVisible)

  const dashHash = await page.locator('section').filter({ hasText: '发布状态' }).locator('code').first().textContent()
  assert('仪表盘: manifest hash 与 snapshotHash(buildSnapshot(config)) 一致', dashHash?.trim() === expectedHash, `ui=${dashHash} expect=${expectedHash}`)

  const servicesAllVisible = await (async () => {
    for (const svc of config.services) {
      try { await page.getByText(svc.name, { exact: true }).first().waitFor({ state: 'visible', timeout: 8000 }) } catch { return false }
    }
    return true
  })()
  assert('仪表盘: GET /api/manifest 的全部服务名可见', servicesAllVisible)

  const card = page.getByTestId(`coll-card-${collName}`)
  await card.getByText(/^\d+$/).waitFor({ state: 'visible', timeout: 15000 })
  const countText = await card.getByText(/^\d+$/).textContent()
  assert(`仪表盘: ${collName} 卡片记录数从 … 变为数字且 ≥ 1`, /^\d+$/.test(countText ?? '') && Number(countText) >= 1, `count=${countText}`)

  // ---------- AC-4 记录浏览 ----------
  step = 'AC-4 记录浏览'
  await card.click()
  await page.locator('tr', { hasText: seedTitle }).first().waitFor({ state: 'visible', timeout: 15000 })
  assert('记录: 播种的唯一 title 在表格行可见', (await page.locator('tr', { hasText: seedTitle }).count()) >= 1)
  await page.locator('tr', { hasText: seedTitle }).first().click()
  await page.getByText('记录详情').waitFor({ state: 'visible', timeout: 10000 })
  const drawerJson = await page.locator('pre').textContent()
  assert('记录: 详情抽屉 JSON 含记录 id', drawerJson?.includes(seededId), `pre=${drawerJson?.slice(0, 80)}`)

  // 过滤/排序：text 字段包含匹配（seedTitle 为含时间戳的唯一值）
  await page.getByRole('button', { name: '✕' }).click()
  await page.locator('tr', { hasText: seedTitle }).first().waitFor({ state: 'visible', timeout: 10000 })
  const rowsBeforeFilter = await page.locator('tbody tr').count()
  await page.getByRole('combobox', { name: '过滤字段' }).selectOption('title')
  await page.getByRole('textbox', { name: '过滤值' }).fill(seedTitle)
  await page.locator('tbody tr', { hasText: seedTitle }).first().waitFor({ state: 'visible', timeout: 10000 })
  const rowsAfterFilter = await page.locator('tbody tr').count()
  assert('记录: 字段过滤收敛结果集并命中目标行', rowsAfterFilter >= 1 && rowsAfterFilter <= rowsBeforeFilter, `before=${rowsBeforeFilter} after=${rowsAfterFilter}`)
  await page.getByText('清除').click()
  await page.getByRole('combobox', { name: '过滤字段' }).selectOption('')
  await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: '← 返回' }).click()
  await page.getByText('发布状态').waitFor({ state: 'visible', timeout: 10000 })

  // ---------- AC-5 编辑器写回（UI 操作 → manifest 文件 → PB schema → .bak 四端交叉） ----------
  step = 'AC-5 编辑器写回'
  await page.getByTestId(`service-card-${svcName}`).getByRole('button', { name: '✎ 编辑服务' }).click()
  const editorHeading = page.getByRole('heading', { name: /编辑服务/ })
  await editorHeading.waitFor({ state: 'visible', timeout: 10000 })
  const saveButton = page.getByRole('button', { name: '写回 manifest 并发布' })
  await saveButton.waitFor({ state: 'visible', timeout: 10000 })
  const headingText = await editorHeading.textContent()
  assert('编辑器: 编辑器视图出现（标题含服务名 + 写回按钮）', headingText?.includes(svcName) && await saveButton.isVisible(), `heading=${headingText}`)

  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: collName, exact: true }) })
  await section.getByRole('button', { name: '+ 添加字段' }).click()
  const newNameInput = page.locator('tbody tr').last().locator('input').first()
  await newNameInput.waitFor({ state: 'visible', timeout: 10000 })
  await newNameInput.fill(uniqueField) // options 输入框保持 addField 给的 '{}'
  await saveButton.click()
  // 保存成功后 onSaved 立即返回仪表盘（编辑器内"发布完成"横幅随视图切换不可见），
  // UI 成功反馈 = 仪表盘"写回并发布成功"报告框；三端交叉验证在下方落地。
  const reportShown = await page.getByText('写回并发布成功')
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false)
  assert('编辑器: 保存后成功横幅出现（写回并发布成功，30s 上限）', reportShown)

  const afterSave = await j(CTRL, 'GET', '/api/manifest', undefined, suToken)
  const savedFields = afterSave.data?.config?.services.find((s) => s.name === svcName)?.collections?.[collName]?.fields ?? {}
  const savedPath = afterSave.data?.path
  assert('编辑器: manifest 对象含新字段 e2e_ui_<ts>', Object.keys(savedFields).includes(uniqueField), Object.keys(savedFields).join(','))
  assert('编辑器: manifest 文件内容含新字段', savedPath === manifestPath && readFileSync(manifestPath, 'utf8').includes(uniqueField))
  const pbColl = await j(PB, 'GET', `/api/collections/${collName}`, undefined, suToken)
  assert('编辑器: PB collection schema 含新字段', pbColl.data?.fields?.some((f) => f.name === uniqueField), JSON.stringify(pbColl.data?.fields?.map((f) => f.name)))
  assert('编辑器: .bak 备份文件存在', existsSync(`${manifestPath}.bak`), `${manifestPath}.bak`)

  // ---------- AC-6 客户端校验拦截 ----------
  step = 'AC-6 客户端校验'
  await page.getByTestId(`service-card-${svcName}`).getByRole('button', { name: '✎ 编辑服务' }).click()
  await page.getByRole('button', { name: '写回 manifest 并发布' }).waitFor({ state: 'visible', timeout: 10000 })
  const section2 = page.locator('section').filter({ has: page.getByRole('heading', { name: collName, exact: true }) })
  await section2.getByRole('button', { name: '+ 添加字段' }).click()
  const badInput = page.locator('tbody tr').last().locator('input').first()
  await badInput.waitFor({ state: 'visible', timeout: 10000 })
  await badInput.fill('bad name')
  await page.getByRole('button', { name: '写回 manifest 并发布' }).click()
  const validationBanner = await page.getByText('字段名非法')
    .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)
  assert('编辑器: 非法字段名保存 → 错误横幅含"字段名非法"', validationBanner)

  const afterBlocked = await j(CTRL, 'GET', '/api/manifest', undefined, suToken)
  const blockedFields = afterBlocked.data?.config?.services.find((s) => s.name === svcName)?.collections?.[collName]?.fields ?? {}
  assert('编辑器: 校验拦截零写回（无 bad name 且 e2e_ui_<ts> 原样保留）',
    !Object.keys(blockedFields).includes('bad name') && Object.keys(blockedFields).includes(uniqueField),
    Object.keys(blockedFields).join(','))
  await page.getByRole('button', { name: '← 返回' }).click()
  await page.getByText('发布状态').waitFor({ state: 'visible', timeout: 10000 })

  // ---------- AC-7 备份面板（confirm 必须显式 accept，否则删除静默失效） ----------
  step = 'AC-7 备份面板'
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await page.locator('header').getByRole('button', { name: '备份' }).click()
  await page.getByText('PB 原生 backups').waitFor({ state: 'visible', timeout: 10000 })
  assert('备份: 备份页出现（PB 原生 backups）', await page.getByText('PB 原生 backups').isVisible())

  await page.getByPlaceholder(/备份名/).fill(backupName)
  await page.getByRole('button', { name: '+ 创建备份' }).click()
  const backupAppeared = await page.getByText(`${backupName}.zip`)
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)
  assert('备份: 创建后列表出现 <name>.zip', backupAppeared)

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: '下载' }).click(),
  ])
  assert('备份: 下载事件 suggestedFilename 为 <name>.zip', download.suggestedFilename() === `${backupName}.zip`, download.suggestedFilename())

  await page.getByRole('button', { name: '删除' }).click()
  const backupGone = await page.getByText(`${backupName}.zip`)
    .waitFor({ state: 'detached', timeout: 15000 }).then(() => true).catch(() => false)
  assert('备份: 接受 confirm 删除后列表不再含该备份', backupGone && (await page.getByText('还没有备份').isVisible()))
} catch (err) {
  await dumpArtifacts(`scenario error: ${err?.message ?? err}`)
  throw err
}

// ---------- AC-8 页面健康：全程无未捕获页面异常 / error 级 console ----------
assert('健康: 全程 pageerror 与 error 级 console 事件为零', pageErrors.length === 0 && consoleErrors.length === 0,
  JSON.stringify({ pageErrors, consoleErrors }))

const result = summary('console-ui')
if (result.failed > 0) await dumpArtifacts('assert failed')
await browser.close()
