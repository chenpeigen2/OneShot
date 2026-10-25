// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

export interface BaseRecord {
  id: string
  created: string
  updated: string
}

export interface UsersRecord extends BaseRecord {
  email?: string
  emailVisibility?: boolean
  verified?: boolean
  name?: string
  avatar?: string
}

export interface BooksRecord extends BaseRecord {
  title: string
  isbn: string
  author: string
  publisher: string
  category: string
  year: number
  summary: string
}

export interface CopiesRecord extends BaseRecord {
  book: string
  barcode: string
  status: string
  location: string
}

export interface BorrowingsRecord extends BaseRecord {
  copy: string
  member: string
  due: string
  returnedAt: string
  renewals: number
  fine: number
}

export interface ReservationsRecord extends BaseRecord {
  book: string
  member: string
  status: string
}
