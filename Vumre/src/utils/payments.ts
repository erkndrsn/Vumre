// Ödeme / borç hesapları. Hem Payload (sunucu) hem Vue tarafından kullanılır; bu yüzden
// dış bağımlılığı yoktur.

export type PaymentMethod = 'cash' | 'transfer' | 'card'

export const PAYMENT_METHOD_OPTIONS: { label: string; value: PaymentMethod }[] = [
  { label: 'Nakit', value: 'cash' },
  { label: 'Havale / EFT', value: 'transfer' },
  { label: 'Kredi kartı', value: 'card' },
]

export const PAYMENT_METHOD_LABELS = Object.fromEntries(
  PAYMENT_METHOD_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PaymentMethod, string>

/**
 * - `unpriced`: odaya atanmamış, borcu yok ve ödemesi de yok
 * - `unpaid`: borcu var, hiç ödeme yapmamış
 * - `partial`: borcunun bir kısmını ödemiş
 * - `paid`: borcu kapanmış
 * - `overpaid`: ödediği borcundan fazla (oda değişikliği sonrası iade)
 * - `advance`: odası belli değil ama ödemesi var (ön ödeme); odaya atanınca ücretten düşülür
 */
export type BalanceStatus = 'unpriced' | 'unpaid' | 'partial' | 'paid' | 'overpaid' | 'advance'

export const BALANCE_STATUS_LABELS: Record<BalanceStatus, string> = {
  unpriced: 'Oda yok',
  unpaid: 'Ödenmedi',
  partial: 'Kısmi ödendi',
  paid: 'Ödendi',
  overpaid: 'Fazla ödeme',
  advance: 'Ön ödeme',
}

/** Kuruş hassasiyetine yuvarlar; 0.1 + 0.2 gibi kayan nokta artıklarını temizler. */
export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function balanceStatus(price: number | null | undefined, paid: number): BalanceStatus {
  if (price == null && paid > 0) return 'advance'
  const debt = price ?? 0
  const balance = roundMoney(debt - paid)
  if (balance < 0) return 'overpaid'
  if (debt <= 0) return paid > 0 ? 'paid' : 'unpriced'
  if (balance === 0) return 'paid'
  return paid > 0 ? 'partial' : 'unpaid'
}

/** Arşivdeki (iptal eden) kişinin ödemesi ön ödeme değil, iade edilecek fazla ödemedir. */
export function memberStatus(
  price: number | null | undefined,
  paid: number,
  archived: boolean,
): BalanceStatus {
  return archived && paid > 0 ? 'overpaid' : balanceStatus(price, paid)
}

/** Bir para birimindeki ücret. */
export interface CurrencyPrice {
  currency: string
  price: number
}

/**
 * Kişilerin diğer para birimlerindeki ücretlerinin toplamı. Yalnızca ücreti olan herkesin
 * fiyatı girilmiş para birimleri yer alır; biri eksikse o para biriminde toplam bilinemez.
 */
export function sumOtherPrices(
  members: { price: number | null; otherPrices?: CurrencyPrice[] | null }[],
): CurrencyPrice[] {
  const priced = members.filter((m) => m.price != null)
  if (!priced.length) return []
  const totals = new Map<string, { sum: number; count: number }>()
  for (const m of priced) {
    for (const o of m.otherPrices ?? []) {
      const t = totals.get(o.currency) ?? { sum: 0, count: 0 }
      t.sum += o.price
      t.count++
      totals.set(o.currency, t)
    }
  }
  return [...totals.entries()]
    .filter(([, t]) => t.count === priced.length)
    .map(([currency, t]) => ({ currency, price: roundMoney(t.sum) }))
}

/**
 * Ödeme alınabilecek para birimleri: önce borcun (ana) para birimi, sonra oda tipinde fiyatı
 * girilmiş diğerleri. Para birimleri arasındaki oran oda ücretlerinden gelir; kur girilmez.
 */
export function payableCurrencies(account: {
  price: number | null
  currency: string | null
  otherPrices?: CurrencyPrice[] | null
}): CurrencyPrice[] {
  if (account.price == null || !account.currency) return []
  return [
    { currency: account.currency, price: account.price },
    ...(account.otherPrices ?? []).filter((o) => o.currency !== account.currency),
  ]
}

/**
 * Ana para birimindeki tutarın `currency` cinsinden karşılığı (oda ücretleri oranıyla).
 * Bu para biriminde ücret yoksa null.
 */
export function convertFromDebt(
  amount: number,
  account: { price: number | null; currency: string | null; otherPrices?: CurrencyPrice[] | null },
  currency: string,
) {
  const target = payableCurrencies(account).find((c) => c.currency === currency)
  if (!target || !account.price) return null
  return roundMoney((amount * target.price) / account.price)
}

/** Borcu kapanmamış (ödeme açığı olan) durumlar. */
export const OPEN_STATUSES: BalanceStatus[] = ['unpaid', 'partial']

/**
 * Telefonu WhatsApp'ın beklediği uluslararası biçime çevirir ("0532 111 22 33" → "905321112233").
 * Türkiye numaraları için ülke kodu eklenir; tanınmayan biçimde null döner.
 */
export function whatsappPhone(phone: string | null | undefined) {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (phone.trim().startsWith('+')) return digits.length >= 10 ? digits : null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = `90${digits.slice(1)}`
  else if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`
  return digits.length >= 11 ? digits : null
}

export interface ReminderValues {
  name: string
  balance: string
  paid: string
  price: string
  room: string
  /** Ödeme grubunun adı; tek kişide boş. */
  group?: string
  /** Hesaptaki kişi sayısı. */
  people?: string
}

export const DEFAULT_REMINDER_TEMPLATE =
  'Sayın {ad}, umre konaklama ücretinizden {kalan} ödemeniz kalmıştır. ' +
  'Ödemenizi en kısa sürede yapmanızı rica ederiz.'

/** Şablondaki {ad}, {kalan}, {odenen}, {ucret}, {oda}, {grup}, {kisiler} yer tutucularını doldurur. */
export function fillReminder(template: string, values: ReminderValues) {
  const map: Record<string, string> = {
    ad: values.name,
    kalan: values.balance,
    odenen: values.paid,
    ucret: values.price,
    oda: values.room,
    grup: values.group ?? '',
    kisiler: values.people ?? '',
  }
  return template.replace(
    /\{(ad|kalan|odenen|ucret|oda|grup|kisiler)\}/g,
    (_, key: string) => map[key] ?? '',
  )
}

/** Arayüzdeki durum rozetinin sınıfı. */
export const BALANCE_STATUS_BADGE: Record<BalanceStatus, string> = {
  unpriced: '',
  unpaid: 'badge-error',
  partial: 'badge-warning',
  paid: 'badge-success',
  overpaid: 'badge-warning',
  advance: 'badge-success',
}

/** Yerel saate göre bugünün tarihi ("2026-10-10"); `<input type="date">` için. */
export function todayInputValue(now: Date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Ödeme hesapları: ödeme grubu veya grubu olmayan tek kişi.

type Id = number | string

/** Hesap toplamı için gereken kişi bakiyesi alanları. */
export interface MemberBalanceLike {
  id: Id
  fullName: string
  phone: string | null
  region: { id: Id; name: string } | null
  room: { id: Id; roomNumber: string } | null
  price: number | null
  currency: string | null
  /** Oda ücretinin diğer para birimlerindeki karşılıkları. */
  otherPrices: CurrencyPrice[]
  /** Ödemelerin borçtan düşülen (ana para birimindeki) toplamı. */
  paid: number
  paymentCount: number
  lastPaymentAt: string | null
  paymentGroup: { id: Id; name: string } | null
  /** Programı iptal edip arşive taşınmış; ödemesi varsa iade edilecek tutardır. */
  archived?: boolean
}

export interface GroupInfo {
  id: Id
  name: string
  responsible: Id | null
  note?: string | null
}

export interface AccountBalance<M extends MemberBalanceLike = MemberBalanceLike> {
  /** "g:12" (grup) veya "p:34" (tek kişi). */
  key: string
  kind: 'group' | 'person'
  groupId: Id | null
  /** Grup adı veya kişinin adı. */
  name: string
  note: string | null
  /** Hatırlatmanın gideceği kişi: grubun sorumlusu, yoksa telefonu olan ilk üye. */
  contact: { pilgrimId: Id; fullName: string; phone: string | null } | null
  /** Grubun sorumlusu atanmış mı (tek kişide her zaman true). */
  hasResponsible: boolean
  currency: string | null
  /** Üyelerin oda ücretleri toplamı; kimse odaya atanmamışsa null. */
  price: number | null
  /** Toplam ücretin diğer para birimlerindeki karşılıkları; bu para birimlerinde de ödeme alınır. */
  otherPrices: CurrencyPrice[]
  paid: number
  balance: number
  status: BalanceStatus
  paymentCount: number
  lastPaymentAt: string | null
  rooms: string[]
  regions: string[]
  members: M[]
}

const unique = (values: (string | null | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'tr'))

function toAccount<M extends MemberBalanceLike>(
  base: Pick<AccountBalance<M>, 'key' | 'kind' | 'groupId' | 'name' | 'note'>,
  members: M[],
  responsible: Id | null,
): AccountBalance<M> {
  const priced = members.filter((m) => m.price != null)
  const price = priced.length ? roundMoney(priced.reduce((sum, m) => sum + m.price!, 0)) : null
  const paid = roundMoney(members.reduce((sum, m) => sum + m.paid, 0))
  const contactMember =
    members.find((m) => responsible !== null && String(m.id) === String(responsible)) ??
    members.find((m) => m.phone) ??
    members[0]
  const last = members
    .map((m) => m.lastPaymentAt)
    .filter((d): d is string => !!d)
    .sort()
    .pop()
  return {
    ...base,
    contact: contactMember
      ? {
          pilgrimId: contactMember.id,
          fullName: contactMember.fullName,
          phone: contactMember.phone,
        }
      : null,
    hasResponsible:
      base.kind === 'person' || members.some((m) => String(m.id) === String(responsible)),
    currency: members.map((m) => m.currency).find(Boolean) ?? null,
    price,
    otherPrices: sumOtherPrices(members),
    paid,
    balance: roundMoney((price ?? 0) - paid),
    status: memberStatus(price, paid, members.length > 0 && members.every((m) => m.archived)),
    paymentCount: members.reduce((sum, m) => sum + m.paymentCount, 0),
    lastPaymentAt: last ?? null,
    rooms: unique(members.map((m) => m.room?.roomNumber)),
    regions: unique(members.map((m) => m.region?.name)),
    members,
  }
}

/**
 * Kişi bakiyelerini hesaplara toplar: her ödeme grubu tek hesap, grubu olmayan herkes
 * kendi hesabı. Grubun borcu üyelerin oda ücretleri, ödemesi üyelerin ödemeleri toplamıdır.
 */
export function buildAccounts<M extends MemberBalanceLike>(
  balances: M[],
  groups: GroupInfo[],
): AccountBalance<M>[] {
  const byGroup = new Map<string, M[]>()
  const singles: M[] = []
  for (const b of balances) {
    if (!b.paymentGroup) {
      singles.push(b)
      continue
    }
    const key = String(b.paymentGroup.id)
    byGroup.set(key, [...(byGroup.get(key) ?? []), b])
  }

  const accounts = [
    ...groups.map((g) =>
      toAccount(
        { key: `g:${g.id}`, kind: 'group', groupId: g.id, name: g.name, note: g.note ?? null },
        byGroup.get(String(g.id)) ?? [],
        g.responsible,
      ),
    ),
    ...singles.map((m) =>
      toAccount(
        { key: `p:${m.id}`, kind: 'person', groupId: null, name: m.fullName, note: null },
        [m],
        m.id,
      ),
    ),
  ]
  return accounts.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}
