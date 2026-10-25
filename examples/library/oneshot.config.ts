import { defineConfig, s, service } from '@oneshot/core'

// 真实图书馆业务模型：
// - books（书目）→ copies（馆藏副本，独立条码+状态）：借的是副本，不是书目
// - borrowings 挂副本；读者有借阅上限（maxBorrow）与累计欠款（fines）
// - reservations 预约队列：全部借出时可预约，归还后预约者优先
// - 逾期罚款：还书时按天结算（0.5 元/天），librarian 可收款清零
export default defineConfig({
  name: 'library',
  baseUrl: 'http://127.0.0.1:8095',
  sidecarUrl: 'http://127.0.0.1:7865',

  auth: {
    collection: 'users',
    signup: 'public',
    fields: {
      name: s.text({ max: 50 }),
      phone: s.text({ max: 20 }),
      role: s.select(['reader', 'librarian'], { required: true, default: 'reader' }),
      blocked: s.bool({ default: false }),
      maxBorrow: s.number({ min: 1, max: 20, onlyInt: true, default: 5 }),
      fines: s.number({ min: 0, default: 0 }),
    },
    listRule: '(id = @request.auth.id || @request.auth.role = "librarian") && @request.auth.blocked != true',
    viewRule: '(id = @request.auth.id || @request.auth.role = "librarian") && @request.auth.blocked != true',
    updateRule: '(id = @request.auth.id || @request.auth.role = "librarian") && @request.auth.blocked != true',
  },

  services: [
    service('library', {
      title: '图书管理',
      collections: {
        // ---------- 书目层 ----------
        books: {
          fields: {
            title: s.text({ required: true, max: 200, presentable: true }),
            isbn: s.text({ required: true, max: 20 }),
            author: s.text({ max: 100 }),
            publisher: s.text({ max: 100 }),
            category: s.select(['文学', '技术', '历史', '儿童', '其他'], { required: true }),
            year: s.number({ min: 1000, max: 3000 }),
            summary: s.text({ max: 1000 }),
          },
          indexes: ['CREATE UNIQUE INDEX idx_library_books_isbn ON books (isbn)'],
          rules: {
            list: 'public', view: 'public',
            create: '@request.auth.role = "librarian" && @request.auth.blocked != true',
            update: '@request.auth.role = "librarian" && @request.auth.blocked != true',
            delete: null,
          },
          seeds: [
            { __key: 'isbn', isbn: '9787536692930', title: '三体', author: '刘慈欣', publisher: '重庆出版社', category: '文学', year: 2008, summary: '地球文明与三体文明的史诗' },
            { __key: 'isbn', isbn: '9787020042494', title: '小王子', author: '圣埃克苏佩里', publisher: '人民文学出版社', category: '儿童', year: 2003, summary: '写给大人的童话' },
            { __key: 'isbn', isbn: '9787111213826', title: '代码大全（第2版）', author: 'Steve McConnell', publisher: '机械工业出版社', category: '技术', year: 2006, summary: '软件构建的百科全书' },
            { __key: 'isbn', isbn: '9787020002207', title: '红楼梦', author: '曹雪芹', publisher: '人民文学出版社', category: '文学', year: 1996, summary: '中国古典小说巅峰' },
          ],
        },

        // ---------- 馆藏副本层 ----------
        copies: {
          fields: {
            book: s.relation('books', { required: true }),
            barcode: s.text({ required: true, max: 30 }),
            status: s.select(['in_shelf', 'on_loan', 'lost', 'repair', 'withdrawn'], { required: true, default: 'in_shelf' }),
            location: s.text({ max: 30 }),
          },
          indexes: [
            'CREATE UNIQUE INDEX idx_library_copies_barcode ON copies (barcode)',
            'CREATE INDEX idx_library_copies_book ON copies (book)',
          ],
          rules: {
            list: 'public', view: 'public',
            create: '@request.auth.role = "librarian" && @request.auth.blocked != true',
            update: '@request.auth.role = "librarian" && @request.auth.blocked != true',
            delete: null,
          },
          seeds: [
            { __key: 'barcode', barcode: 'C-SANTI-001', book: { __collection: 'books', __filter: 'isbn = "9787536692930"' }, location: 'A-01' },
            { __key: 'barcode', barcode: 'C-SANTI-002', book: { __collection: 'books', __filter: 'isbn = "9787536692930"' }, location: 'A-01' },
            { __key: 'barcode', barcode: 'C-SANTI-003', book: { __collection: 'books', __filter: 'isbn = "9787536692930"' }, location: 'A-02' },
            { __key: 'barcode', barcode: 'C-PRINCE-001', book: { __collection: 'books', __filter: 'isbn = "9787020042494"' }, location: 'B-02' },
            { __key: 'barcode', barcode: 'C-PRINCE-002', book: { __collection: 'books', __filter: 'isbn = "9787020042494"' }, location: 'B-02' },
            { __key: 'barcode', barcode: 'C-CODE-001', book: { __collection: 'books', __filter: 'isbn = "9787111213826"' }, location: 'T-11' },
            { __key: 'barcode', barcode: 'C-HLM-001', book: { __collection: 'books', __filter: 'isbn = "9787020002207"' }, location: 'A-05' },
            { __key: 'barcode', barcode: 'C-HLM-002', book: { __collection: 'books', __filter: 'isbn = "9787020002207"' }, location: 'A-05' },
          ],
        },

        // ---------- 借阅（挂副本） ----------
        borrowings: {
          fields: {
            copy: s.relation('copies', { required: true }),
            member: s.relation('users', { required: true }),
            due: s.date({ required: true }),
            returnedAt: s.date(),
            renewals: s.number({ min: 0, max: 2, onlyInt: true, default: 0 }),
            fine: s.number({ min: 0, default: 0 }),
          },
          indexes: [
            'CREATE INDEX idx_library_borrowings_copy ON borrowings (copy)',
            'CREATE INDEX idx_library_borrowings_member ON borrowings (member)',
          ],
          rules: {
            list: '@request.auth.id != "" && @request.auth.blocked != true',
            view: '@request.auth.id != "" && @request.auth.blocked != true',
            create: '@request.auth.id != "" && @request.auth.blocked != true && member = @request.auth.id',
            update: '@request.auth.id != "" && @request.auth.blocked != true && member = @request.auth.id',
            delete: null,
          },
        },

        // ---------- 预约 ----------
        reservations: {
          fields: {
            book: s.relation('books', { required: true }),
            member: s.relation('users', { required: true }),
            status: s.select(['active', 'fulfilled', 'cancelled'], { required: true, default: 'active' }),
          },
          indexes: ['CREATE INDEX idx_library_reservations_book ON reservations (book)'],
          rules: {
            list: '@request.auth.id != "" && @request.auth.blocked != true',
            view: '@request.auth.id != "" && @request.auth.blocked != true',
            create: '@request.auth.id != "" && @request.auth.blocked != true && member = @request.auth.id',
            update: '@request.auth.id != "" && @request.auth.blocked != true && member = @request.auth.id',
            delete: null,
          },
        },
      },
      actions: {
        stats: { method: 'GET', rule: 'authenticated', handler: './hooks/library.ts#stats' },
        borrow: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#borrow' },
        returnBook: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#returnBook' },
        renew: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#renew' },
        reserve: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#reserve' },
        cancelReservation: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#cancelReservation' },
        reportLost: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#reportLost' },
        setCopyStatus: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#setCopyStatus' },
        settleFines: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#settleFines' },
        addBookWithCopies: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#addBookWithCopies' },
        setRole: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#setRole' },
        setBanned: { method: 'POST', rule: 'authenticated', runtime: 'sidecar', handler: './hooks/library.sidecar.ts#setBanned' },
      },
      hooks: './hooks/library.ts',
    }),
  ],

  clients: { ts: { outDir: './web/src/api' } },
})
