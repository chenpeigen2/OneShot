export interface LibraryStats {
  titles: number
  totalCopies: number
  onShelf: number
  onLoan: number
  overdue: number
  activeReservations: number
  myOnLoan: number
}

export interface Toast {
  message: string
  error?: boolean
  id: number
}

export type Notify = (message: string, error?: boolean) => void
