import type { LibraryStats } from './types'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('操作结果格式错误')
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('操作结果缺少文本字段')
  return value
}

function numberValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('操作结果缺少数字字段')
  return value
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('操作结果缺少布尔字段')
  return value
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error('操作结果缺少字符串数组')
  return value as string[]
}

export function decodeStats(value: unknown): LibraryStats {
  const r = object(value)
  return {
    titles: numberValue(r.titles),
    totalCopies: numberValue(r.totalCopies),
    onShelf: numberValue(r.onShelf),
    onLoan: numberValue(r.onLoan),
    overdue: numberValue(r.overdue),
    activeReservations: numberValue(r.activeReservations),
    myOnLoan: numberValue(r.myOnLoan),
  }
}

export function decodeBorrowResult(value: unknown) {
  const r = object(value)
  return {
    borrowingId: text(r.borrowingId),
    book: text(r.book),
    barcode: text(r.barcode),
    location: text(r.location),
    due: text(r.due),
    remainingOnShelf: numberValue(r.remainingOnShelf),
  }
}

export function decodeReturnResult(value: unknown) {
  const r = object(value)
  return {
    borrowingId: text(r.borrowingId),
    returnedAt: text(r.returnedAt),
    fine: numberValue(r.fine),
    overdue: booleanValue(r.overdue),
    reservedByOther: booleanValue(r.reservedByOther),
  }
}

export function decodeRenewResult(value: unknown) {
  const r = object(value)
  return { oldDue: text(r.oldDue), newDue: text(r.newDue), renewals: numberValue(r.renewals) }
}

export function decodeReservationResult(value: unknown) {
  const r = object(value)
  return { reservationId: text(r.reservationId), queuePosition: numberValue(r.queuePosition) }
}

export function decodeAddBookResult(value: unknown) {
  const r = object(value)
  return { bookId: text(r.bookId), title: text(r.title), barcodes: strings(r.barcodes), by: text(r.by) }
}

export function decodeAddCopiesResult(value: unknown) {
  const r = object(value)
  return { bookId: text(r.bookId), barcodes: strings(r.barcodes) }
}

export function decodePaidResult(value: unknown) {
  const r = object(value)
  return { member: text(r.member), paid: numberValue(r.paid) }
}
