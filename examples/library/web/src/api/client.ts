// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

import PocketBase from 'pocketbase'
import type { RecordOptions, RecordFullListOptions, RecordListOptions } from 'pocketbase'
import type { UsersRecord, BooksRecord, CopiesRecord, BorrowingsRecord, ReservationsRecord } from './schema'
import type { UsersRegisterInput } from './schema'

export { PocketBase }
export type { RecordModel, ListResult } from 'pocketbase'
export * from './schema'

export class UsersApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('users') }
  async login(email: string, password: string): Promise<UsersRecord> {
    const auth = await this.coll.authWithPassword(email, password)
    return auth.record as UsersRecord
  }
  get me(): UsersRecord | null {
    return (this.pb.authStore.record as UsersRecord | null) ?? null
  }
  register(data: UsersRegisterInput, options: RecordOptions = {}) {
    return this.coll.create<UsersRecord>(data, options)
  }
  logout() { this.pb.authStore.clear() }
}

export class BooksApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('books') }
  list(page = 1, perPage = 20, options: RecordListOptions = {}) {
    return this.coll.getList<BooksRecord>(page, perPage, options)
  }
  all(options: RecordFullListOptions = {}) {
    return this.coll.getFullList<BooksRecord>(options)
  }
  one(id: string, options: RecordOptions = {}) {
    return this.coll.getOne<BooksRecord>(id, options)
  }
  create(data: Partial<BooksRecord>, options: RecordOptions = {}) {
    return this.coll.create<BooksRecord>(data, options)
  }
  update(id: string, data: Partial<BooksRecord>, options: RecordOptions = {}) {
    return this.coll.update<BooksRecord>(id, data, options)
  }
  remove(id: string, options: RecordOptions = {}) {
    return this.coll.delete(id, options)
  }
  stats(body_: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/stats', { method: 'GET', body: undefined, query }) as Promise<unknown>
  }
  borrow(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/borrow', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  returnBook(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/returnBook', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  renew(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/renew', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reserve(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reserve', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  cancelReservation(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/cancelReservation', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reportLost(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reportLost', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setCopyStatus(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setCopyStatus', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  settleFines(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/settleFines', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addBookWithCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addBookWithCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setRole(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setRole', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setBanned(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setBanned', { method: 'POST', body: body, query }) as Promise<unknown>
  }
}

export class CopiesApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('copies') }
  list(page = 1, perPage = 20, options: RecordListOptions = {}) {
    return this.coll.getList<CopiesRecord>(page, perPage, options)
  }
  all(options: RecordFullListOptions = {}) {
    return this.coll.getFullList<CopiesRecord>(options)
  }
  one(id: string, options: RecordOptions = {}) {
    return this.coll.getOne<CopiesRecord>(id, options)
  }
  create(data: Partial<CopiesRecord>, options: RecordOptions = {}) {
    return this.coll.create<CopiesRecord>(data, options)
  }
  update(id: string, data: Partial<CopiesRecord>, options: RecordOptions = {}) {
    return this.coll.update<CopiesRecord>(id, data, options)
  }
  remove(id: string, options: RecordOptions = {}) {
    return this.coll.delete(id, options)
  }
  stats(body_: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/stats', { method: 'GET', body: undefined, query }) as Promise<unknown>
  }
  borrow(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/borrow', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  returnBook(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/returnBook', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  renew(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/renew', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reserve(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reserve', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  cancelReservation(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/cancelReservation', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reportLost(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reportLost', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setCopyStatus(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setCopyStatus', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  settleFines(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/settleFines', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addBookWithCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addBookWithCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setRole(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setRole', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setBanned(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setBanned', { method: 'POST', body: body, query }) as Promise<unknown>
  }
}

export class BorrowingsApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('borrowings') }
  list(page = 1, perPage = 20, options: RecordListOptions = {}) {
    return this.coll.getList<BorrowingsRecord>(page, perPage, options)
  }
  all(options: RecordFullListOptions = {}) {
    return this.coll.getFullList<BorrowingsRecord>(options)
  }
  one(id: string, options: RecordOptions = {}) {
    return this.coll.getOne<BorrowingsRecord>(id, options)
  }
  create(data: Partial<BorrowingsRecord>, options: RecordOptions = {}) {
    return this.coll.create<BorrowingsRecord>(data, options)
  }
  update(id: string, data: Partial<BorrowingsRecord>, options: RecordOptions = {}) {
    return this.coll.update<BorrowingsRecord>(id, data, options)
  }
  remove(id: string, options: RecordOptions = {}) {
    return this.coll.delete(id, options)
  }
  stats(body_: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/stats', { method: 'GET', body: undefined, query }) as Promise<unknown>
  }
  borrow(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/borrow', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  returnBook(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/returnBook', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  renew(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/renew', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reserve(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reserve', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  cancelReservation(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/cancelReservation', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reportLost(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reportLost', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setCopyStatus(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setCopyStatus', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  settleFines(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/settleFines', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addBookWithCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addBookWithCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setRole(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setRole', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setBanned(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setBanned', { method: 'POST', body: body, query }) as Promise<unknown>
  }
}

export class ReservationsApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('reservations') }
  list(page = 1, perPage = 20, options: RecordListOptions = {}) {
    return this.coll.getList<ReservationsRecord>(page, perPage, options)
  }
  all(options: RecordFullListOptions = {}) {
    return this.coll.getFullList<ReservationsRecord>(options)
  }
  one(id: string, options: RecordOptions = {}) {
    return this.coll.getOne<ReservationsRecord>(id, options)
  }
  create(data: Partial<ReservationsRecord>, options: RecordOptions = {}) {
    return this.coll.create<ReservationsRecord>(data, options)
  }
  update(id: string, data: Partial<ReservationsRecord>, options: RecordOptions = {}) {
    return this.coll.update<ReservationsRecord>(id, data, options)
  }
  remove(id: string, options: RecordOptions = {}) {
    return this.coll.delete(id, options)
  }
  stats(body_: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/stats', { method: 'GET', body: undefined, query }) as Promise<unknown>
  }
  borrow(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/borrow', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  returnBook(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/returnBook', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  renew(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/renew', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reserve(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reserve', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  cancelReservation(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/cancelReservation', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  reportLost(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/reportLost', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setCopyStatus(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setCopyStatus', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  settleFines(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/settleFines', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addBookWithCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addBookWithCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  addCopies(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/addCopies', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setRole(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setRole', { method: 'POST', body: body, query }) as Promise<unknown>
  }
  setBanned(body: Record<string, unknown> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/library/setBanned', { method: 'POST', body: body, query }) as Promise<unknown>
  }
}

export interface OneShotClient {
  pb: PocketBase
  users: UsersApi
  books: BooksApi
  copies: CopiesApi
  borrowings: BorrowingsApi
  reservations: ReservationsApi
}

export function createClient(baseUrl: string): OneShotClient {
  const pb = new PocketBase(baseUrl)
  return {
    pb,
    users: new UsersApi(pb),
    books: new BooksApi(pb),
    copies: new CopiesApi(pb),
    borrowings: new BorrowingsApi(pb),
    reservations: new ReservationsApi(pb),
  }
}
