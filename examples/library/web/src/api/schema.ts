// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

export interface BaseRecord {
  id: string
  created: string
  updated: string
  collectionId: string
  collectionName: string
}

export interface UsersRecord extends BaseRecord {
  email?: string
  emailVisibility?: boolean
  verified?: boolean
  name?: string
  avatar?: string
  phone: string
  role: "reader" | "librarian"
  blocked: boolean
  maxBorrow: number
  fines: number
}

export type UsersRegisterInput = Omit<Partial<UsersRecord>, "role" | "blocked" | "maxBorrow" | "fines"> & { email: string; password: string; passwordConfirm: string }

export interface BooksRecord extends BaseRecord {
  title: string
  isbn: string
  author: string
  publisher: string
  category: "文学" | "技术" | "历史" | "儿童" | "其他"
  year: number
  summary: string
}

export interface CopiesRecord extends BaseRecord {
  book: string
  barcode: string
  status: "in_shelf" | "on_loan" | "lost" | "repair" | "withdrawn"
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
  status: "active" | "fulfilled" | "cancelled"
}
