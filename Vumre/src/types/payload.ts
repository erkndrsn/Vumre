import type {
  AccountBalance as AccountBalanceOf,
  BalanceStatus,
  CurrencyPrice,
  PaymentMethod,
} from '@/utils/payments'
import type {
  CashboxBalance as CashboxBalanceOf,
  CashboxKind,
  CashboxLedger,
  CurrencyCashTotal,
  ExpenseCategory,
  LedgerEntry,
  LedgerType,
} from '@/utils/cash'

// Payload REST API tipleri.
// İpucu: Payload reposunda `payload generate:types` ile üretilen `payload-types.ts`
// dosyası bu klasöre kopyalanıp koleksiyon tipleri oradan kullanılabilir.

/** admin: tüm sistem; regionManager: yalnızca sorumlu olduğu bölgelerin umrecileri. */
export type UserRole = 'admin' | 'regionManager'

export interface User {
  id: number | string
  /** Girişte kullanılır; küçük harfe çevrilerek saklanır. */
  username: string
  /** İsteğe bağlı; yalnızca şifre sıfırlama bağlantısı için. */
  email?: string | null
  name?: string | null
  role?: UserRole | null
  /** Bölge yöneticisinin sorumlu olduğu bölgeler. */
  regions?: (number | Region)[] | null
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

/** Umrecinin uçağa bindiği havalimanı; ana nokta dışındakilerden aktarmalı gelinir. */
export interface FlightPoint {
  id: number
  name: string
  city: string
  /** IATA kodu, ör. ADB. */
  airportCode?: string | null
  /** Genel uçuşun kalktığı nokta (ör. İstanbul); yalnızca bir tane olur. */
  isMain?: boolean | null
  description?: string | null
  active?: boolean | null
  createdAt: string
  updatedAt: string
}

export interface Region {
  id: number
  name: string
  /** Bu bölgedeki umrecilerin varsayılan uçuş noktası (ör. Aydın → İzmir). */
  defaultFlightPoint?: number | FlightPoint | null
  description?: string | null
  active?: boolean | null
  createdAt: string
  updatedAt: string
}

/** Yaş aralığına göre çocuk ücreti; uçlar dahil, tamamlanmış yaş. */
export interface ChildPrice {
  id?: string | null
  minAge: number
  maxAge: number
  price: number
}

/** Oda tipinin ana para birimi dışındaki kişi başı (yetişkin) ücreti. */
export interface OtherPrice {
  id?: string | null
  currency: Currency
  pricePerPerson: number
}

export interface RoomType {
  id: number
  name: string
  capacity: number
  /** Çocuk yaş aralıklarına girmeyen herkesin ücreti. */
  pricePerPerson: number
  childPrices?: ChildPrice[] | null
  /** Ana para birimi; borç bu para biriminde tutulur. */
  currency: Currency
  /** Ödemenin alınabileceği diğer para birimlerindeki ücretler. */
  otherPrices?: OtherPrice[] | null
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
  /** Sunucuda her okumada hesaplanır; bebekler (0-1 yaş) yatak tutmadığı için sayılmaz. */
  occupied?: number | null
  /** Odadaki bebek (0-1 yaş) sayısı. */
  infants?: number | null
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
  region?: number | Region | null
  /** Uçuş başlangıç noktası; boşsa kayıtta bölgenin uçuş noktası atanır. */
  flightPoint?: number | FlightPoint | null
  address?: string | null
  description?: string | null
  room?: number | Room | null
  paymentGroup?: number | PaymentGroup | null
  /** Odaya atanınca oda tipinden otomatik alınır; yaş çocuk aralığına giriyorsa çocuk ücreti. */
  roomPrice?: number | null
  roomCurrency?: string | null
  /** Oda ücretinin diğer para birimlerindeki karşılıkları. */
  roomOtherPrices?: (CurrencyPrice & { id?: string | null })[] | null
  /** Programı iptal etti; odadan çıkarılır, yerleşimde ve listelerde görünmez. */
  archived?: boolean | null
  archivedAt?: string | null
  archiveReason?: string | null
  createdAt: string
  updatedAt: string
}

export type PilgrimDocumentKind = 'idCard' | 'other'

/** Umrecinin kimlik resmi ve diğer dokümanları (yetkili kullanıcıya açık yükleme). */
export interface PilgrimDocument {
  id: number
  pilgrim: number | Pilgrim
  kind: PilgrimDocumentKind
  note?: string | null
  url?: string | null
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  sizes?: { thumbnail?: { url?: string | null } }
  createdAt: string
  updatedAt: string
}

// Oda yerleşim panosu (backend: src/lib/roomBoard.ts)

export interface BoardRoom {
  id: number
  roomNumber: string
  capacity: number
  active: boolean
  description: string | null
  roomType: { id: number; name: string; active: boolean } | null
}

export interface BoardPilgrim {
  id: number
  fullName: string
  gender: Gender
  region: { id: number; name: string } | null
  room: number | null
  /** Bugünkü tamamlanmış yaş; doğum tarihi yoksa null. */
  age: number | null
  /** 0-1 yaş; kapasiteden yer tutmaz. */
  infant: boolean
  paymentGroup: { id: number; name: string } | null
}

export interface RoomBoard {
  rooms: BoardRoom[]
  pilgrims: BoardPilgrim[]
}

export interface BulkRoomsResult {
  created: string[]
  skipped: string[]
}

// Tahsilat / borç takibi (backend: src/collections/Payments.ts, src/lib/payments.ts)

export type { BalanceStatus, CurrencyPrice, PaymentMethod }

export interface Payment {
  id: number
  pilgrim: number | Pilgrim
  /** Alınan tutar (kasaya giren). */
  amount: number
  /** Ödemenin para birimi; boşsa oda ücretinin para birimi. */
  currency?: string | null
  /** Borçtan düşülen tutar (borcun para biriminde). */
  debtAmount?: number | null
  debtCurrency?: string | null
  /** Paranın girdiği kasa. */
  cashbox?: number | Cashbox | null
  paidAt: string
  /** Kasanın türünden gelir. */
  method: PaymentMethod
  receiptNo?: string | null
  note?: string | null
  receivedBy?: number | User | null
  createdAt: string
  updatedAt: string
}

/** Oda ücretine göre bir umrecinin borç özeti. */
export interface PilgrimBalance {
  id: number
  fullName: string
  tcNo: string | null
  passportNo: string | null
  phone: string | null
  region: { id: number; name: string } | null
  room: { id: number; roomNumber: string } | null
  paymentGroup: { id: number; name: string } | null
  /** Oda ücreti (borç); odaya atanmamışsa null. */
  price: number | null
  currency: string | null
  /** Oda ücretinin diğer para birimlerindeki karşılıkları. */
  otherPrices: CurrencyPrice[]
  /** Ödemelerin borçtan düşülen toplamı. */
  paid: number
  /** Kalan borç; eksi ise fazla ödeme. */
  balance: number
  paymentCount: number
  lastPaymentAt: string | null
  status: BalanceStatus
  /** Programı iptal edip arşive taşınmış; ödemesi iade edilecek tutardır. */
  archived: boolean
}

/** Birlikte ödeme yapan kişiler (ör. bir aile); odadan bağımsız. */
export interface PaymentGroup {
  id: number
  name: string
  /** Borç hatırlatmalarının gittiği üye. */
  responsible?: number | Pilgrim | null
  note?: string | null
  createdAt: string
  updatedAt: string
}

/** Ödeme hesabı: bir ödeme grubu veya grubu olmayan tek kişi. */
export type AccountBalance = AccountBalanceOf<PilgrimBalance>

// Kasalar / giderler / virman (backend: src/collections/Cashboxes.ts, Expenses.ts,
// CashTransfers.ts, src/lib/cash.ts)

export type {
  CashboxKind,
  CashboxLedger,
  CurrencyCashTotal,
  ExpenseCategory,
  LedgerEntry,
  LedgerType,
}

/** Tek para birimli kasa (nakit kasa, banka hesabı, POS). */
export interface Cashbox {
  id: number
  name: string
  currency: Currency
  kind: CashboxKind
  active?: boolean | null
  note?: string | null
  createdAt: string
  updatedAt: string
}

export type CashboxBalance = CashboxBalanceOf & { id: number; currency: Currency }

/** Kasalar arası aktarım: `from`dan `amount` çıkar, `to`ya `toAmount` girer. */
export interface CashTransfer {
  id: number
  from: number | Cashbox
  to: number | Cashbox
  amount: number
  toAmount?: number | null
  transferredAt: string
  note?: string | null
  createdBy?: number | User | null
  createdAt: string
  updatedAt: string
}

/** Kasadan yapılan ödeme. */
export interface Expense {
  id: number
  description: string
  category: ExpenseCategory
  payee?: string | null
  /** Paranın çıktığı kasa; para birimi ve ödeme şekli kasadan gelir. */
  cashbox?: number | Cashbox | null
  amount: number
  currency: Currency
  paidAt: string
  method: PaymentMethod
  receiptNo?: string | null
  note?: string | null
  paidBy?: number | User | null
  createdAt: string
  updatedAt: string
}
