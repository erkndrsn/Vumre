// Kasa hesabı: her kasa tek para birimlidir; bakiyesi tahsilatlar + gelen virmanlar − giderler −
// giden virmanlardır. Bakiye saklanmaz, her seferinde hareketlerden hesaplanır. Hem Payload
// (sunucu) hem Vue tarafından kullanılır; bu yüzden dış bağımlılığı yoktur.

import { roundMoney, type PaymentMethod } from './payments'

type Id = number | string

export type ExpenseCategory = 'hotel' | 'transport' | 'visa' | 'flight' | 'food' | 'guide' | 'other'

export const EXPENSE_CATEGORY_OPTIONS: { label: string; value: ExpenseCategory }[] = [
  { label: 'Otel / konaklama', value: 'hotel' },
  { label: 'Uçak bileti', value: 'flight' },
  { label: 'Ulaşım', value: 'transport' },
  { label: 'Vize', value: 'visa' },
  { label: 'Yemek', value: 'food' },
  { label: 'Rehber / personel', value: 'guide' },
  { label: 'Diğer', value: 'other' },
]

export const EXPENSE_CATEGORY_LABELS = Object.fromEntries(
  EXPENSE_CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ExpenseCategory, string>

/** Kasa türü; kasaya giren/çıkan hareketin ödeme şekli de budur. */
export type CashboxKind = PaymentMethod

export const CASHBOX_KIND_OPTIONS: { label: string; value: CashboxKind }[] = [
  { label: 'Nakit kasa', value: 'cash' },
  { label: 'Banka hesabı', value: 'transfer' },
  { label: 'Kredi kartı / POS', value: 'card' },
]

export const CASHBOX_KIND_LABELS = Object.fromEntries(
  CASHBOX_KIND_OPTIONS.map((o) => [o.value, o.label]),
) as Record<CashboxKind, string>

/** Eski (kasasız) kayıtlar için otomatik açılan kasaların adı: "Nakit USD", "Banka SAR"… */
export const DEFAULT_CASHBOX_PREFIX: Record<CashboxKind, string> = {
  cash: 'Nakit',
  transfer: 'Banka',
  card: 'Kart',
}

export interface CashboxLike {
  id: Id
  name: string
  currency: string
  kind?: CashboxKind | null
  active?: boolean | null
}

/** Kasaya giren (tahsilat) veya kasadan çıkan (gider) hareket. */
export interface CashMovement {
  cashbox?: Id | { id: Id } | null
  amount?: number | null
}

/** Kasalar arası virman: `from` kasasından `amount` çıkar, `to` kasasına `toAmount` girer. */
export interface TransferMovement {
  from?: Id | { id: Id } | null
  to?: Id | { id: Id } | null
  amount?: number | null
  toAmount?: number | null
}

export interface CashTotals {
  /** Tahsilatlar. */
  income: number
  /** Giderler (yapılan ödemeler). */
  expense: number
  transferIn: number
  transferOut: number
  /** Kalan; eksi ise çıkanlar girenleri aşmış. */
  balance: number
}

export interface CashboxBalance extends CashTotals {
  id: Id
  name: string
  currency: string
  kind: CashboxKind
  active: boolean
}

const idOf = (value: Id | { id: Id } | null | undefined) =>
  value === null || value === undefined
    ? null
    : String(typeof value === 'object' ? value.id : value)

/** Her kasanın giren/çıkan toplamları ve bakiyesi. Aktif kasalar önce, sonra döviz ve ad sırası. */
export function summarizeCashboxes(
  cashboxes: CashboxLike[],
  payments: CashMovement[],
  expenses: CashMovement[],
  transfers: TransferMovement[],
): CashboxBalance[] {
  const totals = new Map(
    cashboxes.map((c) => [String(c.id), { income: 0, expense: 0, transferIn: 0, transferOut: 0 }]),
  )
  const add = (
    id: string | null,
    key: keyof Omit<CashTotals, 'balance'>,
    amount?: number | null,
  ) => {
    const entry = id === null ? undefined : totals.get(id)
    if (entry && amount) entry[key] += amount
  }
  payments.forEach((p) => add(idOf(p.cashbox), 'income', p.amount))
  expenses.forEach((e) => add(idOf(e.cashbox), 'expense', e.amount))
  transfers.forEach((t) => {
    add(idOf(t.from), 'transferOut', t.amount)
    add(idOf(t.to), 'transferIn', t.toAmount ?? t.amount)
  })

  return cashboxes
    .map((c) => {
      const t = totals.get(String(c.id))!
      return {
        id: c.id,
        name: c.name,
        currency: c.currency,
        kind: c.kind ?? 'cash',
        active: c.active !== false,
        income: roundMoney(t.income),
        expense: roundMoney(t.expense),
        transferIn: roundMoney(t.transferIn),
        transferOut: roundMoney(t.transferOut),
        balance: roundMoney(t.income + t.transferIn - t.expense - t.transferOut),
      }
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        a.currency.localeCompare(b.currency) ||
        a.name.localeCompare(b.name, 'tr'),
    )
}

export interface CurrencyCashTotal {
  currency: string
  balance: number
  cashboxCount: number
}

/** Döviz bazında tüm kasaların toplam bakiyesi (dövizler birbirine çevrilmez). */
export function totalsByCurrency(balances: CashboxBalance[]): CurrencyCashTotal[] {
  const map = new Map<string, CurrencyCashTotal>()
  for (const b of balances) {
    const entry = map.get(b.currency) ?? { currency: b.currency, balance: 0, cashboxCount: 0 }
    entry.balance = roundMoney(entry.balance + b.balance)
    entry.cashboxCount++
    map.set(b.currency, entry)
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}

export type LedgerType = 'payment' | 'expense' | 'transfer-in' | 'transfer-out'

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  payment: 'Tahsilat',
  expense: 'Ödeme',
  'transfer-in': 'Gelen virman',
  'transfer-out': 'Giden virman',
}

/** Kasa dökümüne girecek tek hareket; `amount` her zaman pozitiftir, yönü `type` belirler. */
export interface LedgerMovement {
  type: LedgerType
  id: Id
  /** Hareket tarihi (ISO). */
  date: string
  createdAt?: string | null
  description: string
  amount: number
}

export interface LedgerEntry extends Omit<LedgerMovement, 'amount'> {
  in: number
  out: number
  /** Bu hareketten sonraki bakiye. */
  balance: number
}

export interface CashboxLedger {
  /** `from` tarihinden önceki hareketlerden devreden bakiye. */
  opening: number
  entries: LedgerEntry[]
  totalIn: number
  totalOut: number
  closing: number
}

const isIncoming = (type: LedgerType) => type === 'payment' || type === 'transfer-in'

/**
 * Tarih sıralı kasa dökümü ve yürüyen bakiye. `from`/`to` gün olarak (YYYY-MM-DD, dahil) verilir;
 * `from`dan önceki hareketler devreden bakiyeye toplanır, `to`dan sonrakiler alınmaz.
 */
export function buildLedger(
  movements: LedgerMovement[],
  range: { from?: string | null; to?: string | null } = {},
): CashboxLedger {
  const day = (iso: string) => iso.slice(0, 10)
  const sorted = [...movements].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
      Number(isIncoming(b.type)) - Number(isIncoming(a.type)),
  )

  let opening = 0
  let balance = 0
  let totalIn = 0
  let totalOut = 0
  const entries: LedgerEntry[] = []
  for (const { amount, ...m } of sorted) {
    const signed = isIncoming(m.type) ? amount : -amount
    if (range.from && day(m.date) < range.from) {
      opening = roundMoney(opening + signed)
      balance = opening
      continue
    }
    if (range.to && day(m.date) > range.to) continue
    balance = roundMoney(balance + signed)
    if (signed >= 0) totalIn += amount
    else totalOut += amount
    entries.push({
      ...m,
      in: signed >= 0 ? roundMoney(amount) : 0,
      out: signed < 0 ? roundMoney(amount) : 0,
      balance,
    })
  }
  return {
    opening,
    entries,
    totalIn: roundMoney(totalIn),
    totalOut: roundMoney(totalOut),
    closing: balance,
  }
}
