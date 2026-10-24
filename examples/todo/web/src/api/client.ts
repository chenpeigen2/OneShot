// 由 oneshot gen 自动生成，请勿手改。重新生成：oneshot gen

import PocketBase from 'pocketbase'
import type { RecordOptions, RecordFullListOptions, RecordListOptions } from 'pocketbase'
import type { UsersRecord, TasksRecord } from './schema'

export { PocketBase }
export type { RecordModel, ListResult } from 'pocketbase'
export * from './schema'

export class UsersApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('users') }
  async login(email: string, password: string): Promise<UsersRecord> {
    const auth = await this.coll.authWithPassword(email, password)
    return auth.record as unknown as UsersRecord
  }
  get me(): UsersRecord | null {
    return (this.pb.authStore.record as unknown as UsersRecord) ?? null
  }
  register(data: Partial<UsersRecord> & { password: string; passwordConfirm: string }, options: RecordOptions = {}) {
    return this.coll.create<UsersRecord>(data, options)
  }
  logout() { this.pb.authStore.clear() }
}

export class TasksApi {
  constructor(readonly pb: PocketBase) {}
  private get coll() { return this.pb.collection('tasks') }
  list(page = 1, perPage = 20, options: RecordListOptions = {}) {
    return this.coll.getList<TasksRecord>(page, perPage, options)
  }
  all(options: RecordFullListOptions = {}) {
    return this.coll.getFullList<TasksRecord>(options)
  }
  one(id: string, options: RecordOptions = {}) {
    return this.coll.getOne<TasksRecord>(id, options)
  }
  create(data: Partial<TasksRecord> & Record<string, any>, options: RecordOptions = {}) {
    return this.coll.create<TasksRecord>(data, options)
  }
  update(id: string, data: Partial<TasksRecord> & Record<string, any>, options: RecordOptions = {}) {
    return this.coll.update<TasksRecord>(id, data, options)
  }
  remove(id: string, options: RecordOptions = {}) {
    return this.coll.delete(id, options)
  }
  stats(body_: Record<string, any> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/tasks/stats', { method: 'GET', body: undefined, query }) as Promise<any>
  }
  summary(body_: Record<string, any> = {}, query: Record<string, string> = {}) {
    return this.pb.send('/api/oneshot/tasks/summary', { method: 'GET', body: undefined, query }) as Promise<any>
  }
}

export interface OneShotClient {
  pb: PocketBase
  users: UsersApi
  tasks: TasksApi
}

export function createClient(baseUrl: string): OneShotClient {
  const pb = new PocketBase(baseUrl)
  return {
    pb,
    users: new UsersApi(pb),
    tasks: new TasksApi(pb),
  }
}
