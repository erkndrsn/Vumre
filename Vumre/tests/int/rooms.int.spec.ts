// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isValidTcNo } from '@/collections/Pilgrims'
import type { Pilgrim, Room, RoomType } from '@/payload-types'

let payload: Payload
let seq = 0
const suffix = Date.now().toString(36)
const created: { collection: 'pilgrims' | 'rooms' | 'room-types'; id: number }[] = []

async function createRoomType(capacity: number, pricePerPerson: number) {
  const doc = await payload.create({
    collection: 'room-types',
    data: {
      name: `${capacity} Kişilik ${suffix}-${++seq}`,
      capacity,
      pricePerPerson,
      currency: 'USD',
    },
  })
  created.push({ collection: 'room-types', id: doc.id })
  return doc
}

async function createRoom(roomNumber: string, roomType: RoomType) {
  const doc = await payload.create({
    collection: 'rooms',
    data: { roomNumber: `${roomNumber}-${suffix}`, roomType: roomType.id },
  })
  created.push({ collection: 'rooms', id: doc.id })
  return doc
}

async function createPilgrim(firstName: string, room?: Room) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName, lastName: 'Test', gender: 'male', room: room?.id },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

describe('Oda ve konaklama', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    // Önce umreciler, sonra odalar, en son oda tipleri silinmeli.
    for (const collection of ['pilgrims', 'rooms', 'room-types'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('oda kapasitesini oda tipinden alır ve doluluğu hesaplar', async () => {
    const type = await createRoomType(3, 1000)
    const room = await createRoom('101', type)
    expect(room.capacity).toBe(3)
    expect(room.occupied).toBe(0)
    expect(room.status).toBe('empty')

    await createPilgrim('Ahmet', room)
    const partial = await payload.findByID({ collection: 'rooms', id: room.id })
    expect(partial.occupied).toBe(1)
    expect(partial.status).toBe('partial')
  })

  it('kapasite aşımını engeller ve ücreti oda tipinden atar', async () => {
    const type = await createRoomType(3, 1000)
    const room = await createRoom('102', type)

    const people: Pilgrim[] = []
    for (const name of ['Ahmet', 'Mehmet', 'Ali']) people.push(await createPilgrim(name, room))
    for (const p of people) {
      expect(p.roomPrice).toBe(1000)
      expect(p.roomCurrency).toBe('USD')
    }

    const full = await payload.findByID({ collection: 'rooms', id: room.id })
    expect(full.occupied).toBe(3)
    expect(full.status).toBe('full')

    await expect(createPilgrim('Veli', room)).rejects.toThrow()

    // Odasız kayıt edilip sonradan dolu odaya atanmak da engellenir.
    const waiting = await createPilgrim('Hasan')
    await expect(
      payload.update({ collection: 'pilgrims', id: waiting.id, data: { room: room.id } }),
    ).rejects.toThrow()

    // Odadaki birinin bilgisini güncellemek kapasite hatası vermez.
    const updated = await payload.update({
      collection: 'pilgrims',
      id: people[0]!.id,
      data: { phone: '5550000000' },
    })
    expect(updated.roomPrice).toBe(1000)
  })

  it('odadan çıkarılınca ücret temizlenir ve yer açılır', async () => {
    const type = await createRoomType(2, 1200)
    const room = await createRoom('201', type)
    const a = await createPilgrim('Ayşe', room)
    await createPilgrim('Fatma', room)

    const removed = await payload.update({ collection: 'pilgrims', id: a.id, data: { room: null } })
    expect(removed.room).toBeNull()
    expect(removed.roomPrice).toBeNull()

    const after = await payload.findByID({ collection: 'rooms', id: room.id })
    expect(after.occupied).toBe(1)
  })

  it('oda tipi kapasitesi doluluğun altına düşürülemez, artınca odalar güncellenir', async () => {
    const type = await createRoomType(3, 1000)
    const room = await createRoom('301', type)
    await createPilgrim('Ömer', room)
    await createPilgrim('Osman', room)

    await expect(
      payload.update({ collection: 'room-types', id: type.id, data: { capacity: 1 } }),
    ).rejects.toThrow()

    await payload.update({ collection: 'room-types', id: type.id, data: { capacity: 4 } })
    const after = await payload.findByID({ collection: 'rooms', id: room.id })
    expect(after.capacity).toBe(4)
  })

  it('içinde umreci olan oda silinemez', async () => {
    const type = await createRoomType(2, 1200)
    const room = await createRoom('401', type)
    await createPilgrim('Yusuf', room)
    await expect(payload.delete({ collection: 'rooms', id: room.id })).rejects.toThrow()
  })

  it('TC Kimlik No algoritmasını doğrular', () => {
    expect(isValidTcNo('10000000146')).toBe(true)
    expect(isValidTcNo('10000000147')).toBe(false)
    expect(isValidTcNo('01234567890')).toBe(false)
  })
})
