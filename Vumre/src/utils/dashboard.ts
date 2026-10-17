// Panel (ana sayfa) özet hesapları. Yerleşim panosu ve ödeme hesaplarından türetilir.

import { CHILD_MAX_AGE } from './childPricing'
import { roundMoney } from './payments'

type Id = number | string
type RoomState = 'empty' | 'partial' | 'full'

interface RoomLike {
  id: Id
  capacity: number
  active: boolean
  roomType: { id: Id; name: string } | null
}

interface PilgrimLike {
  gender: 'male' | 'female'
  region: { id: Id; name: string } | null
  room: Id | null
  /** Bugünkü yaş; bilinmiyorsa null (yetişkin sayılır). */
  age: number | null
  infant: boolean
}

interface AccountLike {
  currency: string | null
  price: number | null
  paid: number
  balance: number
}

export interface RoomTypeSummary {
  key: string
  name: string
  rooms: number
  full: number
  partial: number
  empty: number
  beds: number
  occupiedBeds: number
}

export interface AccommodationSummary {
  /** Toplam = erkek + kadın + çocuk; bebekler kontenjan tutmadığı için hariç. */
  pilgrims: number
  /** Yetişkin erkek (çocuk ve bebekler hariç). */
  male: number
  /** Yetişkin kadın (çocuk ve bebekler hariç). */
  female: number
  /** Bebek olmayan, CHILD_MAX_AGE yaşına kadar (dahil) çocuklar. */
  children: number
  /** Toplama ve oda/bölge sayılarına girmez. */
  infants: number
  assigned: number
  unassigned: number
  /** Yalnız aktif odalar sayılır. */
  rooms: number
  full: number
  partial: number
  empty: number
  beds: number
  occupiedBeds: number
  byType: RoomTypeSummary[]
  byRegion: { name: string; count: number }[]
}

export interface CurrencySummary {
  currency: string
  /** Oda ücretleri toplamı (toplam tutar). */
  total: number
  /** Tahsil edilen. */
  paid: number
  /** Kapanmamış hesapların kalan borcu. */
  open: number
  openAccounts: number
  /** Fazla ödenen (iade edilecek) tutar. */
  overpaid: number
  /** Odası belli olmadan alınmış ön ödemeler (oda ücretine henüz yazılmadı). */
  advance: number
}

function stateOf(occupied: number, capacity: number): RoomState {
  if (occupied <= 0) return 'empty'
  if (occupied >= capacity) return 'full'
  return 'partial'
}

/** Umreci ve oda doluluk özeti; bebekler (0-1 yaş) yatak tutmaz ve umreci sayılmaz. */
export function summarizeAccommodation(
  rooms: RoomLike[],
  pilgrims: PilgrimLike[],
): AccommodationSummary {
  const occupiedByRoom = new Map<string, number>()
  const regions = new Map<string, { name: string; count: number }>()
  const s: AccommodationSummary = {
    pilgrims: 0,
    male: 0,
    female: 0,
    children: 0,
    infants: 0,
    assigned: 0,
    unassigned: 0,
    rooms: 0,
    full: 0,
    partial: 0,
    empty: 0,
    beds: 0,
    occupiedBeds: 0,
    byType: [],
    byRegion: [],
  }

  for (const p of pilgrims) {
    // Bebekler kontenjandan yer tutmaz; umreci sayılarına girmez, ayrıca gösterilir.
    if (p.infant) {
      s.infants++
      continue
    }
    s.pilgrims++
    if (p.age !== null && p.age <= CHILD_MAX_AGE) s.children++
    else if (p.gender === 'male') s.male++
    else if (p.gender === 'female') s.female++
    if (p.room === null) s.unassigned++
    else {
      s.assigned++
      const key = String(p.room)
      occupiedByRoom.set(key, (occupiedByRoom.get(key) ?? 0) + 1)
    }
    const regionKey = p.region ? String(p.region.id) : ''
    const region = regions.get(regionKey) ?? {
      name: p.region?.name ?? 'Bölge seçilmemiş',
      count: 0,
    }
    region.count++
    regions.set(regionKey, region)
  }

  const types = new Map<string, RoomTypeSummary>()
  for (const r of rooms) {
    if (!r.active) continue
    const occupied = Math.min(occupiedByRoom.get(String(r.id)) ?? 0, r.capacity)
    const state = stateOf(occupied, r.capacity)
    const key = r.roomType ? String(r.roomType.id) : ''
    const t = types.get(key) ?? {
      key,
      name: r.roomType?.name ?? 'Tipi belirsiz',
      rooms: 0,
      full: 0,
      partial: 0,
      empty: 0,
      beds: 0,
      occupiedBeds: 0,
    }
    for (const target of [s, t]) {
      target.rooms++
      target[state]++
      target.beds += r.capacity
      target.occupiedBeds += occupied
    }
    types.set(key, t)
  }

  s.byType = [...types.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  s.byRegion = [...regions.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr'),
  )
  return s
}

/**
 * Para birimine göre toplam tutar / tahsilat / kalan. Ödeme grupları tek hesap
 * sayıldığından bir üyenin fazla ödemesi grubun borcundan düşer (Ödeme Takibi ile aynı).
 */
export function summarizeMoney(accounts: AccountLike[]): CurrencySummary[] {
  const map = new Map<string, CurrencySummary>()
  for (const a of accounts) {
    if (!a.currency) continue
    const t = map.get(a.currency) ?? {
      currency: a.currency,
      total: 0,
      paid: 0,
      open: 0,
      openAccounts: 0,
      overpaid: 0,
      advance: 0,
    }
    t.total += a.price ?? 0
    t.paid += a.paid
    if (a.price == null) {
      t.advance += a.paid
    } else if (a.balance > 0) {
      t.open += a.balance
      t.openAccounts++
    } else if (a.balance < 0) {
      t.overpaid -= a.balance
    }
    map.set(a.currency, t)
  }
  return [...map.values()]
    .map((t) => ({
      ...t,
      total: roundMoney(t.total),
      paid: roundMoney(t.paid),
      open: roundMoney(t.open),
      overpaid: roundMoney(t.overpaid),
      advance: roundMoney(t.advance),
    }))
    .sort((a, b) => b.total - a.total)
}

/** 0-1 arası oran; payda sıfırsa 0. */
export function ratio(value: number, total: number) {
  return total > 0 ? Math.min(value / total, 1) : 0
}
