import type { PayloadRequest, Where } from 'payload'

import { isInfant } from '../utils/childPricing'

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

/** Arşivde olmayan (programı iptal etmemiş) umreciler; eski kayıtlarda alan boş olabilir. */
export const notArchived: Where = { archived: { not_equals: true } }

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

/**
 * Kapasitesi dolmuş odaların id'leri. `excludePilgrimId` verilirse o kişi sayılmaz;
 * böylece kişinin zaten kaldığı oda "dolu" görünmez. Bebekler kapasiteden yer tutmaz.
 */
export async function findFullRoomIds(req: PayloadRequest, excludePilgrimId?: Id) {
  const [{ docs: rooms }, { docs: pilgrims }] = await Promise.all([
    req.payload.find({
      collection: 'rooms',
      select: { capacity: true },
      pagination: false,
      depth: 0,
      context: { skipOccupancy: true },
      req,
    }),
    req.payload.find({
      collection: 'pilgrims',
      where: {
        room: { exists: true },
        ...(excludePilgrimId !== undefined ? { id: { not_equals: excludePilgrimId } } : {}),
      },
      select: { room: true, birthDate: true },
      pagination: false,
      depth: 0,
      req,
    }),
  ])

  const occupied = new Map<string, number>()
  for (const p of pilgrims) {
    if (isInfant(p.birthDate)) continue
    const roomId = relationId(p.room)
    if (roomId !== null) occupied.set(String(roomId), (occupied.get(String(roomId)) ?? 0) + 1)
  }
  return rooms
    .filter((r) => (occupied.get(String(r.id)) ?? 0) >= (r.capacity ?? 0))
    .map((r) => r.id)
}

/**
 * Odadaki umreciler: `total` herkes, `infants` bebekler, `occupied` kapasiteden yer tutanlar.
 * `excludePilgrimId` güncellenen kaydın kendisini saymamak içindir.
 */
export async function roomOccupancy(req: PayloadRequest, roomId: Id, excludePilgrimId?: Id) {
  const { docs } = await req.payload.find({
    collection: 'pilgrims',
    where: {
      room: { equals: roomId },
      ...(excludePilgrimId !== undefined ? { id: { not_equals: excludePilgrimId } } : {}),
    },
    select: { birthDate: true },
    pagination: false,
    depth: 0,
    req,
  })
  const infants = docs.filter((p) => isInfant(p.birthDate)).length
  return { total: docs.length, infants, occupied: docs.length - infants }
}

/** Odada kapasiteden yer tutan (bebek olmayan) umreci sayısı. */
export async function countOccupants(req: PayloadRequest, roomId: Id, excludePilgrimId?: Id) {
  return (await roomOccupancy(req, roomId, excludePilgrimId)).occupied
}
