// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assignPilgrims, createRooms, getRoomBoard } from '@/lib/roomBoard'
import { expandRoomRange } from '@/utils/accommodation'
import type { RoomType } from '@/payload-types'

let payload: Payload
let req: PayloadRequest
let seq = 0
const suffix = Date.now().toString(36)
let regionId: number
const created: {
  collection: 'pilgrims' | 'rooms' | 'room-types' | 'regions' | 'users'
  id: number
}[] = []

async function createRoomType(capacity: number, pricePerPerson = 1000) {
  const doc = await payload.create({
    collection: 'room-types',
    data: {
      name: `Pano ${capacity} Kişilik ${suffix}-${++seq}`,
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
    data: { roomNumber: `P${roomNumber}-${suffix}`, roomType: roomType.id },
  })
  created.push({ collection: 'rooms', id: doc.id })
  return doc
}

async function createPilgrim(
  firstName: string,
  gender: 'male' | 'female' = 'male',
  birthDate?: string,
) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName, lastName: 'Pano', gender, region: regionId, birthDate },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

async function roomOf(pilgrimId: number) {
  const p = await payload.findByID({ collection: 'pilgrims', id: pilgrimId, depth: 0 })
  return { room: p.room, roomPrice: p.roomPrice }
}

describe('Oda yerleşim panosu', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `board-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)

    const region = await payload.create({
      collection: 'regions',
      data: { name: `Pano Bölgesi ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })
  })

  afterAll(async () => {
    for (const collection of ['pilgrims', 'rooms', 'room-types', 'regions', 'users'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('oda aralığını numaralara açar', () => {
    expect(expandRoomRange('101', '104').numbers).toEqual(['101', '102', '103', '104'])
    expect(expandRoomRange('08', '10', 'A-').numbers).toEqual(['A-08', 'A-09', 'A-10'])
    expect(expandRoomRange('10', '5').error).toBeTruthy()
    expect(expandRoomRange('1', '1000').error).toBeTruthy()
    expect(expandRoomRange('a', '5').error).toBeTruthy()
  })

  it('toplu oda oluşturur, var olan numaraları atlar', async () => {
    const type = await createRoomType(3)
    const numbers = [`B1-${suffix}`, `B2-${suffix}`, `B3-${suffix}`]
    const first = await createRooms(req, { roomType: type.id, roomNumbers: numbers.slice(0, 2) })
    expect(first.created).toEqual(numbers.slice(0, 2))

    const second = await createRooms(req, { roomType: type.id, roomNumbers: numbers })
    expect(second.created).toEqual([numbers[2]])
    expect(second.skipped).toEqual(numbers.slice(0, 2))

    const { docs } = await payload.find({
      collection: 'rooms',
      where: { roomNumber: { in: numbers } },
      pagination: false,
    })
    docs.forEach((r) => created.push({ collection: 'rooms', id: r.id }))
    expect(docs).toHaveLength(3)
    expect(docs.every((r) => r.capacity === 3)).toBe(true)
  })

  it('pasif oda tipiyle toplu oda oluşturmaz', async () => {
    const type = await createRoomType(2)
    await payload.update({ collection: 'room-types', id: type.id, data: { active: false } })
    await expect(
      createRooms(req, { roomType: type.id, roomNumbers: [`X-${suffix}`] }),
    ).rejects.toThrow(/pasif/)
  })

  it('seçilenleri odaya toplu atar ve ücreti yazar', async () => {
    const type = await createRoomType(3, 1500)
    const room = await createRoom('201', type)
    const a = await createPilgrim('Ahmet')
    const b = await createPilgrim('Mehmet')

    const res = await assignPilgrims(req, { room: room.id, pilgrims: [a.id, b.id] })
    expect(res.updated).toBe(2)
    expect(await roomOf(a.id)).toEqual({ room: room.id, roomPrice: 1500 })
    expect((await roomOf(b.id)).room).toBe(room.id)
  })

  it('bebekler dolu odaya toplu atanabilir, panoda bebek olarak işaretlenir', async () => {
    const type = await createRoomType(2)
    const room = await createRoom('205', type)
    const adults = [await createPilgrim('Anne', 'female'), await createPilgrim('Baba')]
    await assignPilgrims(req, { room: room.id, pilgrims: adults.map((p) => p.id) })

    const baby = new Date()
    baby.setUTCMonth(baby.getUTCMonth() - 8)
    const infant = await createPilgrim('Bebek', 'female', baby.toISOString().slice(0, 10))
    const extra = await createPilgrim('Fazla')

    // Bebekle birlikte yatak gereken biri seçilirse hiçbiri taşınmaz.
    await expect(
      assignPilgrims(req, { room: room.id, pilgrims: [infant.id, extra.id] }),
    ).rejects.toThrow(/boş yer/)
    expect((await roomOf(infant.id)).room).toBeNull()

    await assignPilgrims(req, { room: room.id, pilgrims: [infant.id] })
    expect((await roomOf(infant.id)).room).toBe(room.id)

    const board = await getRoomBoard(req)
    expect(board.pilgrims.find((p) => p.id === infant.id)?.infant).toBe(true)
    expect(board.pilgrims.find((p) => p.id === adults[0]!.id)?.infant).toBe(false)
  })

  it('kapasiteyi aşan toplu atamada kimseyi taşımaz', async () => {
    const type = await createRoomType(2)
    const room = await createRoom('202', type)
    const people = [
      await createPilgrim('Ali'),
      await createPilgrim('Veli'),
      await createPilgrim('Can'),
    ]

    await expect(
      assignPilgrims(req, { room: room.id, pilgrims: people.map((p) => p.id) }),
    ).rejects.toThrow(/boş yer/)
    for (const p of people) expect((await roomOf(p.id)).room).toBeNull()
  })

  it('odalar arası taşır ve odadan çıkarır', async () => {
    const type = await createRoomType(2)
    const from = await createRoom('301', type)
    const to = await createRoom('302', type)
    const a = await createPilgrim('Ayşe', 'female')
    const b = await createPilgrim('Fatma', 'female')
    await assignPilgrims(req, { room: from.id, pilgrims: [a.id, b.id] })

    // Odada zaten olan kişi tekrar atanırsa sayılmaz, yer de tutmaz.
    expect((await assignPilgrims(req, { room: from.id, pilgrims: [a.id, b.id] })).updated).toBe(0)

    await assignPilgrims(req, { room: to.id, pilgrims: [a.id] })
    expect((await roomOf(a.id)).room).toBe(to.id)

    await assignPilgrims(req, { room: null, pilgrims: [b.id] })
    expect(await roomOf(b.id)).toEqual({ room: null, roomPrice: null })
  })

  it('pasif odaya atama yapmaz', async () => {
    const type = await createRoomType(2)
    const room = await createRoom('401', type)
    await payload.update({ collection: 'rooms', id: room.id, data: { active: false } })
    const p = await createPilgrim('Osman')
    await expect(assignPilgrims(req, { room: room.id, pilgrims: [p.id] })).rejects.toThrow(/pasif/)
  })

  it('pano verisinde odalar ve odasız umreciler yer alır', async () => {
    const type = await createRoomType(2)
    const room = await createRoom('501', type)
    const inRoom = await createPilgrim('Yusuf')
    const waiting = await createPilgrim('Yakup')
    await assignPilgrims(req, { room: room.id, pilgrims: [inRoom.id] })

    const board = await getRoomBoard(req)
    const boardRoom = board.rooms.find((r) => r.id === room.id)
    expect(boardRoom).toMatchObject({ capacity: 2, active: true, roomType: { id: type.id } })
    expect(board.pilgrims.find((p) => p.id === inRoom.id)?.room).toBe(room.id)
    expect(board.pilgrims.find((p) => p.id === waiting.id)).toMatchObject({
      room: null,
      region: { id: regionId },
      age: null,
    })
  })

  it('pano verisinde yaş doğum tarihinden hesaplanır', async () => {
    const now = new Date()
    // Bugünden 40 yıl ve 1 gün önce doğan kişi 40 yaşındadır.
    const birth = new Date(
      Date.UTC(now.getUTCFullYear() - 40, now.getUTCMonth(), now.getUTCDate() - 1, 12),
    )
    const p = await payload.create({
      collection: 'pilgrims',
      data: {
        firstName: 'Yaşlı',
        lastName: 'Pano',
        gender: 'male',
        region: regionId,
        birthDate: birth.toISOString(),
      },
    })
    created.push({ collection: 'pilgrims', id: p.id })

    const board = await getRoomBoard(req)
    expect(board.pilgrims.find((x) => x.id === p.id)).toMatchObject({ age: 40, infant: false })
  })
})
