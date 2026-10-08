import type { PayloadRequest } from 'payload'

export type RoomStatus = 'empty' | 'partial' | 'full'

export const ROOM_STATUS_OPTIONS: { label: string; value: RoomStatus }[] = [
  { label: 'Boş', value: 'empty' },
  { label: 'Kısmen Dolu', value: 'partial' },
  { label: 'Dolu', value: 'full' },
]

export const CURRENCY_OPTIONS = [
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'SAR', value: 'SAR' },
  { label: 'TRY', value: 'TRY' },
]

type Id = number | string

/** İlişki alanı değerini (id veya populate edilmiş doküman) id'ye indirger. */
export function relationId(value: unknown): Id | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return (value as { id?: Id }).id ?? null
  return value as Id
}

export function roomStatus(occupied: number, capacity: number): RoomStatus {
  if (occupied <= 0) return 'empty'
  if (occupied >= capacity) return 'full'
  return 'partial'
}

/** Odaya atanmış umreci sayısı. `excludePilgrimId` güncellenen kaydın kendisini saymamak içindir. */
export async function countOccupants(req: PayloadRequest, roomId: Id, excludePilgrimId?: Id) {
  const { totalDocs } = await req.payload.count({
    collection: 'pilgrims',
    where: {
      room: { equals: roomId },
      ...(excludePilgrimId !== undefined ? { id: { not_equals: excludePilgrimId } } : {}),
    },
    req,
  })
  return totalDocs
}
