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

export interface TasksRecord extends BaseRecord {
  title: string
  done: boolean
  priority: number
  due: string
  tags: string[]
  notes: any
  owner: string
}
