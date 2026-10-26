import { s, type ServiceDef } from '@oneshot/core'

export const libraryCollections = {
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
      create: '@request.auth.email = "oneshot-service@system.local"',
      update: '@request.auth.email = "oneshot-service@system.local"',
      delete: null,
    },
    seeds: [
      { __key: 'barcode', barcode: 'C-SANTI-001', book: { __collection: 'books', __filter: 'isbn = "9787536692930"' }, status: 'in_shelf', location: 'A-01' },
      { __key: 'barcode', barcode: 'C-SANTI-002', book: { __collection: 'books', __filter: 'isbn = "9787536692930"' }, status: 'in_shelf', location: 'A-01' },
      { __key: 'barcode', barcode: 'C-SANTI-003', book: { __collection: 'books', __filter: 'isbn = "9787536692930"' }, status: 'in_shelf', location: 'A-02' },
      { __key: 'barcode', barcode: 'C-PRINCE-001', book: { __collection: 'books', __filter: 'isbn = "9787020042494"' }, status: 'in_shelf', location: 'B-02' },
      { __key: 'barcode', barcode: 'C-PRINCE-002', book: { __collection: 'books', __filter: 'isbn = "9787020042494"' }, status: 'in_shelf', location: 'B-02' },
      { __key: 'barcode', barcode: 'C-CODE-001', book: { __collection: 'books', __filter: 'isbn = "9787111213826"' }, status: 'in_shelf', location: 'T-11' },
      { __key: 'barcode', barcode: 'C-HLM-001', book: { __collection: 'books', __filter: 'isbn = "9787020002207"' }, status: 'in_shelf', location: 'A-05' },
      { __key: 'barcode', barcode: 'C-HLM-002', book: { __collection: 'books', __filter: 'isbn = "9787020002207"' }, status: 'in_shelf', location: 'A-05' },
    ],
  },

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
      'CREATE INDEX idx_library_borrowings_member ON borrowings (member)',
      "CREATE UNIQUE INDEX idx_library_borrowings_active_copy ON borrowings (copy) WHERE returnedAt = ''",
    ],
    rules: {
      list: '@request.auth.blocked != true && (member = @request.auth.id || @request.auth.role = "librarian")',
      view: '@request.auth.blocked != true && (member = @request.auth.id || @request.auth.role = "librarian")',
      create: '@request.auth.email = "oneshot-service@system.local"',
      update: '@request.auth.email = "oneshot-service@system.local"',
      delete: null,
    },
  },

  reservations: {
    fields: {
      book: s.relation('books', { required: true }),
      member: s.relation('users', { required: true }),
      status: s.select(['active', 'fulfilled', 'cancelled'], { required: true, default: 'active' }),
    },
    indexes: [
      'CREATE INDEX idx_library_reservations_book ON reservations (book)',
      "CREATE UNIQUE INDEX idx_library_reservations_active_member ON reservations (book, member) WHERE status = 'active'",
    ],
    rules: {
      list: '@request.auth.blocked != true && (member = @request.auth.id || @request.auth.role = "librarian")',
      view: '@request.auth.blocked != true && (member = @request.auth.id || @request.auth.role = "librarian")',
      create: '@request.auth.email = "oneshot-service@system.local"',
      update: '@request.auth.email = "oneshot-service@system.local"',
      delete: null,
    },
  },
} satisfies ServiceDef['collections']
