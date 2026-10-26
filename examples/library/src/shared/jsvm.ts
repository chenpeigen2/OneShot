export interface JsvmRecord {
  get(field: string): unknown
  set(field: string, value: unknown): void
}

export interface JsvmApp {
  findRecordsByFilter(collection: string, filter: string, sort: string, limit: number, offset: number): unknown[]
}

export interface JsvmHookContext {
  coll: string
  record: JsvmRecord
}

export interface JsvmActionContext {
  app: JsvmApp
  auth: { id: string } | null
}
