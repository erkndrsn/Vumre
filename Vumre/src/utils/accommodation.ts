import type { Currency, Gender, Room, RoomStatus, RoomType } from '@/types/payload'

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

/** "3/3" gibi doluluk metni. */
export function occupancyText(room: Room) {
  return `${room.occupied ?? 0}/${room.capacity ?? 0}`
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
