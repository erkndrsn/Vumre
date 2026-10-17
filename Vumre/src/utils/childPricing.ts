// Oda tipi ücretlerinde yaş aralığına göre çocuk fiyatı. Hem Payload (sunucu) hem Vue
// tarafından kullanılır; bu yüzden dış bağımlılığı yoktur.

import { roundMoney, type CurrencyPrice } from './payments'

export interface AgePrice {
  minAge: number
  maxAge: number
  price: number
}

/** Oda tipinin ana para birimi dışındaki kişi başı (yetişkin) ücreti. */
export interface OtherPrice {
  currency: string
  pricePerPerson: number
}

export interface PricedRoomType {
  pricePerPerson: number
  childPrices?: AgePrice[] | null
  otherPrices?: OtherPrice[] | null
}

/** `on` tarihindeki tamamlanmış yaş. Doğum tarihi yoksa / geçersizse null. */
export function ageOn(birthDate: string | Date | null | undefined, on: Date = new Date()) {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  if (Number.isNaN(birth.getTime())) return null
  let age = on.getUTCFullYear() - birth.getUTCFullYear()
  const monthDiff = on.getUTCMonth() - birth.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < birth.getUTCDate())) age--
  return Math.max(0, age)
}

/** Bu yaşa kadar (dahil) bebek sayılır. Bebekler oda kapasitesinden yer tutmaz. */
export const INFANT_MAX_AGE = 1

/** Doğum tarihine göre bugün bebek mi? Doğum tarihi yoksa bebek sayılmaz. */
export function isInfant(birthDate: string | Date | null | undefined, on: Date = new Date()) {
  const age = ageOn(birthDate, on)
  return age !== null && age <= INFANT_MAX_AGE
}

/**
 * Bu yaşa kadar (dahil) çocuk sayılır; bebeklik yaşı hariç. Yalnızca listelerde ayırt etmek
 * içindir; çocuk ücreti oda tipindeki yaş aralıklarına göre belirlenir.
 */
export const CHILD_MAX_AGE = 11

/** Doğum tarihine göre bugün çocuk (bebek değil) mu? Doğum tarihi yoksa çocuk sayılmaz. */
export function isChild(birthDate: string | Date | null | undefined, on: Date = new Date()) {
  const age = ageOn(birthDate, on)
  return age !== null && age > INFANT_MAX_AGE && age <= CHILD_MAX_AGE
}

/**
 * Yaşı kapsayan çocuk fiyatı, yoksa normal kişi başı ücret. Aralıklar iki uç dahildir:
 * "2-6" → 2, 3, 4, 5 ve 6 yaşındakiler. Yaşı bilinmeyen kişiye normal ücret uygulanır.
 */
export function priceForAge(roomType: PricedRoomType, age: number | null) {
  if (age !== null) {
    const match = roomType.childPrices?.find((r) => age >= r.minAge && age <= r.maxAge)
    if (match) return match.price
  }
  return roomType.pricePerPerson
}

/**
 * Kişinin diğer para birimlerindeki ücreti. O para birimindeki yetişkin ücretinin ana ücrete
 * oranı çocuk ücretine de uygulanır: 1200 USD = 1100 EUR ise 600 USD'lik çocuk 550 EUR öder.
 */
export function otherPricesForAge(roomType: PricedRoomType, age: number | null): CurrencyPrice[] {
  const price = priceForAge(roomType, age)
  return (roomType.otherPrices ?? []).map((o) => ({
    currency: o.currency,
    price:
      roomType.pricePerPerson > 0
        ? roundMoney((price * o.pricePerPerson) / roomType.pricePerPerson)
        : o.pricePerPerson,
  }))
}

/** Diğer para birimi satırlarındaki ilk hata (eksik, tekrar eden veya ana para birimi), yoksa null. */
export function otherPriceError(
  rows: Partial<OtherPrice>[] | null | undefined,
  baseCurrency: string | null | undefined,
): string | null {
  const seen = new Set<string>()
  for (const [i, r] of (rows ?? []).entries()) {
    if (!r.currency || r.pricePerPerson == null) {
      return `Diğer para birimlerinde ${i + 1}. satırda para birimi ve ücret zorunludur.`
    }
    if (r.currency === baseCurrency) {
      return `${r.currency} zaten ana para birimi; diğer para birimlerine eklenemez.`
    }
    if (seen.has(r.currency)) return `${r.currency} için birden fazla ücret girilmiş.`
    seen.add(r.currency)
  }
  return null
}

/** Aralık listesindeki ilk hata mesajı (ters aralık veya çakışma), sorun yoksa null. */
export function agePriceError(rows: Partial<AgePrice>[] | null | undefined): string | null {
  if (!rows?.length) return null
  for (const [i, r] of rows.entries()) {
    if (r.minAge == null || r.maxAge == null || r.price == null) {
      return `${i + 1}. satırda yaş aralığı ve ücret zorunludur.`
    }
    if (!Number.isInteger(r.minAge) || !Number.isInteger(r.maxAge)) {
      return `${i + 1}. satırda yaşlar tam sayı olmalıdır.`
    }
    if (r.minAge > r.maxAge) {
      return `${i + 1}. satırda başlangıç yaşı (${r.minAge}) bitiş yaşından (${r.maxAge}) büyük.`
    }
  }
  const sorted = [...rows].sort((a, b) => a.minAge! - b.minAge!)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    if (cur.minAge! <= prev.maxAge!) {
      return `${prev.minAge}-${prev.maxAge} ve ${cur.minAge}-${cur.maxAge} yaş aralıkları çakışıyor.`
    }
  }
  return null
}

/** "0-1 yaş: 350 · 2-6 yaş: 500" gibi kısa özet için sıralı liste. */
export function sortedAgePrices(rows: AgePrice[] | null | undefined) {
  return [...(rows ?? [])].sort((a, b) => a.minAge - b.minAge)
}
