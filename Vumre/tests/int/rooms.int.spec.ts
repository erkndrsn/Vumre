// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { isValidTcNo } from '@/collections/Pilgrims'
import { findFullRoomIds } from '@/lib/rooms'
import { createLocalReq } from 'payload'
import type { Pilgrim, Room, RoomType } from '@/payload-types'

let payload: Payload
let seq = 0
const suffix = Date.now().toString(36)
let regionId: number
const created: { collection: 'pilgrims' | 'rooms' | 'room-types' | 'regions'; id: number }[] = []

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

async function createPilgrim(firstName: string, room?: Room, birthDate?: string) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: {
      firstName,
      lastName: 'Test',
      gender: 'male',
      region: regionId,
      room: room?.id,
      birthDate,
    },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

describe('Oda ve konaklama', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const region = await payload.create({
      collection: 'regions',
      data: { name: `Bölge ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })
  })

  afterAll(async () => {
    // Önce umreciler, sonra odalar, oda tipleri ve bölgeler silinmeli.
    for (const collection of ['pilgrims', 'rooms', 'room-types', 'regions'] as const) {
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

  it('çocuklara yaş aralığına göre ücret uygular', async () => {
    const yearsAgo = (years: number) => {
      const d = new Date()
      d.setUTCFullYear(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate() - 10)
      return d.toISOString().slice(0, 10)
    }
    const doc = await payload.create({
      collection: 'room-types',
      data: {
        name: `3 Kişilik Çocuklu ${suffix}`,
        capacity: 3,
        pricePerPerson: 1800,
        currency: 'USD',
        childPrices: [
          { minAge: 0, maxAge: 1, price: 350 },
          { minAge: 2, maxAge: 6, price: 500 },
          { minAge: 7, maxAge: 12, price: 900 },
        ],
      },
    })
    created.push({ collection: 'room-types', id: doc.id })
    const roomA = await createRoom('601', doc)
    const roomB = await createRoom('602', doc)

    expect((await createPilgrim('Bebek', roomA, yearsAgo(1))).roomPrice).toBe(350)
    expect((await createPilgrim('Küçük', roomA, yearsAgo(6))).roomPrice).toBe(500)
    expect((await createPilgrim('Çocuk', roomA, yearsAgo(7))).roomPrice).toBe(900)
    expect((await createPilgrim('Genç', roomB, yearsAgo(13))).roomPrice).toBe(1800)
    const noBirth = await createPilgrim('Yaşsız', roomB)
    expect(noBirth.roomPrice).toBe(1800)

    // Odadayken doğum tarihi girilirse ücret yaşa göre yeniden hesaplanır.
    const fixed = await payload.update({
      collection: 'pilgrims',
      id: noBirth.id,
      data: { birthDate: yearsAgo(3) },
    })
    expect(fixed.roomPrice).toBe(500)
  })

  it('bebekler (0-1 yaş) kapasiteye bakılmadan odaya eklenir', async () => {
    const monthsAgo = (months: number) => {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() - months)
      return d.toISOString().slice(0, 10)
    }
    const type = await createRoomType(2, 1000)
    const room = await createRoom('701', type)
    await createPilgrim('Anne', room)
    await createPilgrim('Baba', room)

    // Oda dolu: 2 yaşındaki çocuk eklenemez, 8 aylık ve 1,5 yaşındaki bebekler eklenir.
    await expect(createPilgrim('Çocuk', room, monthsAgo(25))).rejects.toThrow()
    const baby = await createPilgrim('Bebek', room, monthsAgo(8))
    await createPilgrim('Bebek2', room, monthsAgo(18))

    const after = await payload.findByID({ collection: 'rooms', id: room.id })
    expect(after.occupied).toBe(2)
    expect(after.infants).toBe(2)
    expect(after.status).toBe('full')

    // Dolu odada bebeğin doğum tarihi bebeklik dışına düzeltilemez (yatak tutmaya başlardı).
    const error = await payload
      .update({ collection: 'pilgrims', id: baby.id, data: { birthDate: monthsAgo(40) } })
      .catch((e: { data?: { errors?: { message: string }[] } }) => e)
    expect(JSON.stringify(error)).toMatch(/bebek sayılmıyor/)

    // Bebekler oda tipi kapasitesi düşürülürken de sayılmaz.
    await payload.update({ collection: 'room-types', id: type.id, data: { capacity: 2 } })
  })

  it('çakışan çocuk yaş aralıkları kaydedilemez', async () => {
    await expect(
      payload.create({
        collection: 'room-types',
        data: {
          name: `Çakışan ${suffix}`,
          capacity: 2,
          pricePerPerson: 1000,
          currency: 'USD',
          childPrices: [
            { minAge: 0, maxAge: 6, price: 300 },
            { minAge: 6, maxAge: 12, price: 600 },
          ],
        },
      }),
    ).rejects.toThrow()
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

  it('oda tipi ücreti değişince odadaki umrecilerin ücreti güncellenir', async () => {
    const yearsAgo = (years: number) => {
      const d = new Date()
      d.setUTCFullYear(d.getUTCFullYear() - years, d.getUTCMonth(), d.getUTCDate() - 10)
      return d.toISOString().slice(0, 10)
    }
    const type = await createRoomType(3, 1000)
    const room = await createRoom('801', type)
    const adult = await createPilgrim('Yusuf', room)
    const child = await createPilgrim('Zeynep', room, yearsAgo(4))
    const waiting = await createPilgrim('Bekleyen')

    await payload.update({
      collection: 'room-types',
      id: type.id,
      data: { pricePerPerson: 1500, childPrices: [{ minAge: 2, maxAge: 6, price: 600 }] },
    })
    const get = (id: number) => payload.findByID({ collection: 'pilgrims', id })
    expect((await get(adult.id)).roomPrice).toBe(1500)
    expect((await get(child.id)).roomPrice).toBe(600)
    expect((await get(waiting.id)).roomPrice ?? null).toBeNull()

    await payload.update({ collection: 'room-types', id: type.id, data: { currency: 'EUR' } })
    expect((await get(adult.id)).roomCurrency).toBe('EUR')
  })

  it('içinde umreci olan oda silinemez', async () => {
    const type = await createRoomType(2, 1200)
    const room = await createRoom('401', type)
    await createPilgrim('Yusuf', room)
    await expect(payload.delete({ collection: 'rooms', id: room.id })).rejects.toThrow()
  })

  it('dolu odalar seçim listesinden çıkar, kişinin kendi odası çıkmaz', async () => {
    const type = await createRoomType(2, 1200)
    const full = await createRoom('501', type)
    const free = await createRoom('502', type)
    const a = await createPilgrim('Zeynep', full)
    await createPilgrim('Elif', full)

    const req = await createLocalReq({}, payload)
    const ids = (await findFullRoomIds(req)).map(String)
    expect(ids).toContain(String(full.id))
    expect(ids).not.toContain(String(free.id))

    // Odadaki kişi düzenlenirken kendi odası seçilebilir kalmalı.
    const forA = (await findFullRoomIds(req, a.id)).map(String)
    expect(forA).not.toContain(String(full.id))
  })

  it('bölge zorunludur ve umrecisi olan bölge silinemez', async () => {
    await expect(
      payload.create({
        collection: 'pilgrims',
        data: { firstName: 'Bölgesiz', lastName: 'Test', gender: 'male' },
      }),
    ).rejects.toThrow()

    const p = await createPilgrim('Bölgeli')
    expect(typeof p.region === 'object' ? p.region?.id : p.region).toBe(regionId)
    await expect(payload.delete({ collection: 'regions', id: regionId })).rejects.toThrow()
  })

  it('TC Kimlik No algoritmasını doğrular', () => {
    expect(isValidTcNo('10000000146')).toBe(true)
    expect(isValidTcNo('10000000147')).toBe(false)
    expect(isValidTcNo('01234567890')).toBe(false)
  })
})
