import type { Currency, FlightPoint, Gender, Room, RoomStatus, RoomType } from '@/types/payload'

export const CURRENCIES: Currency[] = ['USD', 'EUR', 'SAR', 'TRY']

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Erkek',
  female: 'Kadın',
}

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  empty: 'Boş',
  partial: 'Kısmen Dolu',
  full: 'Dolu',
}

export const ROOM_STATUS_BADGE: Record<RoomStatus, string> = {
  empty: 'badge-success',
  partial: 'badge-warning',
  full: 'badge-error',
}

export function formatMoney(amount: number | null | undefined, currency?: string | null) {
  if (amount === null || amount === undefined) return '—'
  const value = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount)
  return currency ? `${value} ${currency}` : value
}

export function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('tr-TR') : '—'
}

/** "3/3" gibi doluluk metni; odada bebek varsa "3/3 + 1 bebek". */
export function occupancyText(room: Room) {
  const text = `${room.occupied ?? 0}/${room.capacity ?? 0}`
  return room.infants ? `${text} + ${room.infants} bebek` : text
}

export function freeBeds(room: Room) {
  return Math.max(0, (room.capacity ?? 0) - (room.occupied ?? 0))
}

/** Tablodaki "Durum" sütunu: Dolu / 1 Boş / Boş. */
export function roomStatusText(room: Room) {
  const status = room.status ?? 'empty'
  return status === 'partial' ? `${freeBeds(room)} Boş` : ROOM_STATUS_LABELS[status]
}

export function roomTypeOf(room: Room): RoomType | null {
  return typeof room.roomType === 'object' ? room.roomType : null
}

export const MAX_BULK_ROOMS = 500

/**
 * "101"–"120" aralığını oda numaralarına açar. Başlangıç baştaki sıfırlarla yazılırsa
 * ("01") aynı genişlik korunur. Önek/sonek her numaraya eklenir (ör. "A-101").
 */
export function expandRoomRange(
  from: string,
  to: string,
  prefix = '',
  suffix = '',
): { numbers: string[]; error?: string } {
  const start = from.trim()
  const end = to.trim()
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end)) {
    return { numbers: [], error: 'Başlangıç ve bitiş sayı olmalıdır.' }
  }
  const a = Number(start)
  const b = Number(end)
  if (a > b) return { numbers: [], error: 'Bitiş, başlangıçtan küçük olamaz.' }
  if (b - a + 1 > MAX_BULK_ROOMS) {
    return { numbers: [], error: `Tek seferde en fazla ${MAX_BULK_ROOMS} oda oluşturulabilir.` }
  }
  const width = start.startsWith('0') ? start.length : 0
  const numbers: string[] = []
  for (let n = a; n <= b; n++) {
    numbers.push(`${prefix.trim()}${String(n).padStart(width, '0')}${suffix.trim()}`)
  }
  return { numbers }
}

/** Uçuş noktasının kısa adı: "İzmir (ADB)". */
export function flightPointLabel(point: FlightPoint | number | null | undefined): string | null {
  if (!point || typeof point !== 'object') return null
  return point.airportCode ? `${point.city} (${point.airportCode})` : point.city
}
