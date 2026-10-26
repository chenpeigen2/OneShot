import { booleanValue, enumValue, isObject, numberValue, optionalString, requiredString } from './values'

export const COPY_STATUSES = ['in_shelf', 'on_loan', 'lost', 'repair', 'withdrawn'] as const
export const MANAGED_COPY_STATUSES = ['in_shelf', 'lost', 'repair', 'withdrawn'] as const
export const RESERVATION_STATUSES = ['active', 'fulfilled', 'cancelled'] as const
export const MEMBER_ROLES = ['reader', 'librarian'] as const
export const BOOK_CATEGORIES = ['文学', '技术', '历史', '儿童', '其他'] as const

export type CopyStatus = typeof COPY_STATUSES[number]
export type ManagedCopyStatus = typeof MANAGED_COPY_STATUSES[number]
export type ReservationStatus = typeof RESERVATION_STATUSES[number]
export type MemberRole = typeof MEMBER_ROLES[number]
export type BookCategory = typeof BOOK_CATEGORIES[number]

export interface BookRecord {
  id: string
  title: string
  isbn: string
  author: string
  publisher: string
  category: BookCategory
  year: number
  summary: string
}

export interface CopyRecord {
  id: string
  book: string
  barcode: string
  status: CopyStatus
  location: string
}

export interface BorrowingRecord {
  id: string
  copy: string
  member: string
  due: string
  returnedAt: string
  renewals: number
  fine: number
}

export interface ReservationRecord {
  id: string
  book: string
  member: string
  status: ReservationStatus
}

export interface MemberRecord {
  id: string
  email: string
  role: MemberRole
  blocked: boolean
  maxBorrow: number
  fines: number
}

export interface ListResult<T> {
  items: T[]
  totalItems: number
}

export function decodeBook(value: unknown): BookRecord {
  if (!isObject(value)) throw new Error('书目记录格式错误')
  return {
    id: requiredString(value.id, 'book.id'),
    title: requiredString(value.title, 'book.title'),
    isbn: requiredString(value.isbn, 'book.isbn'),
    author: optionalString(value.author, 'book.author'),
    publisher: optionalString(value.publisher, 'book.publisher'),
    category: enumValue(value.category, 'book.category', BOOK_CATEGORIES),
    year: numberValue(value.year, 'book.year'),
    summary: optionalString(value.summary, 'book.summary'),
  }
}

export function decodeCopy(value: unknown): CopyRecord {
  if (!isObject(value)) throw new Error('副本记录格式错误')
  return {
    id: requiredString(value.id, 'copy.id'),
    book: requiredString(value.book, 'copy.book'),
    barcode: requiredString(value.barcode, 'copy.barcode'),
    status: enumValue(value.status, 'copy.status', COPY_STATUSES),
    location: optionalString(value.location, 'copy.location'),
  }
}

export function decodeBorrowing(value: unknown): BorrowingRecord {
  if (!isObject(value)) throw new Error('借阅记录格式错误')
  return {
    id: requiredString(value.id, 'borrowing.id'),
    copy: requiredString(value.copy, 'borrowing.copy'),
    member: requiredString(value.member, 'borrowing.member'),
    due: requiredString(value.due, 'borrowing.due'),
    returnedAt: optionalString(value.returnedAt, 'borrowing.returnedAt'),
    renewals: numberValue(value.renewals, 'borrowing.renewals'),
    fine: numberValue(value.fine, 'borrowing.fine'),
  }
}

export function decodeReservation(value: unknown): ReservationRecord {
  if (!isObject(value)) throw new Error('预约记录格式错误')
  return {
    id: requiredString(value.id, 'reservation.id'),
    book: requiredString(value.book, 'reservation.book'),
    member: requiredString(value.member, 'reservation.member'),
    status: enumValue(value.status, 'reservation.status', RESERVATION_STATUSES),
  }
}

export function decodeMember(value: unknown): MemberRecord {
  if (!isObject(value)) throw new Error('读者记录格式错误')
  return {
    id: requiredString(value.id, 'member.id'),
    email: optionalString(value.email, 'member.email'),
    role: enumValue(value.role, 'member.role', MEMBER_ROLES),
    blocked: booleanValue(value.blocked, 'member.blocked', false),
    maxBorrow: numberValue(value.maxBorrow, 'member.maxBorrow', 5),
    fines: numberValue(value.fines, 'member.fines'),
  }
}

export function decodeList<T>(decode: (value: unknown) => T) {
  return (value: unknown): ListResult<T> => {
    if (!isObject(value) || !Array.isArray(value.items)) throw new Error('列表响应格式错误')
    return {
      items: value.items.map(decode),
      totalItems: numberValue(value.totalItems, 'totalItems', value.items.length),
    }
  }
}
