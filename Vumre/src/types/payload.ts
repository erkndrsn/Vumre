// Payload REST API tipleri.
// İpucu: Payload reposunda `payload generate:types` ile üretilen `payload-types.ts`
// dosyası bu klasöre kopyalanıp koleksiyon tipleri oradan kullanılabilir.

export interface User {
  id: number | string
  email: string
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export interface PaginatedDocs<T> {
  docs: T[]
  totalDocs: number
  limit: number
  totalPages: number
  page?: number
  pagingCounter: number
  hasPrevPage: boolean
  hasNextPage: boolean
  prevPage?: number | null
  nextPage?: number | null
}

export interface PayloadErrorResponse {
  errors?: {
    message: string
    name?: string
    data?: { errors?: { message: string; path?: string }[] } | null
  }[]
  message?: string
}

export interface LoginResponse {
  user: User
  token?: string
  exp?: number
  message?: string
}

export interface MeResponse {
  user: User | null
  token?: string
  exp?: number
  collection?: string
}

export type WhereOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_equal'
  | 'less_than'
  | 'less_than_equal'
  | 'like'
  | 'contains'
  | 'in'
  | 'not_in'
  | 'exists'

export type WhereField = Partial<Record<WhereOperator, unknown>>

export interface Where {
  [field: string]: Where[] | WhereField | undefined
  and?: Where[]
  or?: Where[]
}

// Konaklama modülü (backend: src/collections/RoomTypes.ts, Rooms.ts, Pilgrims.ts)

export type Currency = 'USD' | 'EUR' | 'SAR' | 'TRY'
export type RoomStatus = 'empty' | 'partial' | 'full'
export type Gender = 'male' | 'female'

export interface RoomType {
  id: number
  name: string
  capacity: number
  pricePerPerson: number
  currency: Currency
  description?: string | null
  active?: boolean | null
  createdAt: string
  updatedAt: string
}

export interface Room {
  id: number
  roomNumber: string
  roomType: number | RoomType
  /** Oda tipinden otomatik gelir. */
  capacity?: number | null
  /** Sunucuda her okumada hesaplanır. */
  occupied?: number | null
  status?: RoomStatus | null
  active?: boolean | null
  description?: string | null
  createdAt: string
  updatedAt: string
}

export interface Pilgrim {
  id: number
  firstName: string
  lastName: string
  fullName?: string | null
  tcNo?: string | null
  passportNo?: string | null
  phone?: string | null
  birthDate?: string | null
  gender: Gender
  address?: string | null
  description?: string | null
  room?: number | Room | null
  /** Odaya atanınca oda tipinin kişi başı ücretinden otomatik alınır. */
  roomPrice?: number | null
  roomCurrency?: string | null
  createdAt: string
  updatedAt: string
}
