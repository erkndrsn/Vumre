// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { testCashboxes } from '../helpers/cashboxes'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createGroup } from '@/lib/paymentGroups'

let payload: Payload
let req: PayloadRequest
let seq = 0
const suffix = Date.now().toString(36)
const cashboxes = testCashboxes(() => payload, suffix)
let regionId: number
type Slug = 'payments' | 'pilgrims' | 'payment-groups' | 'rooms' | 'room-types' | 'regions' | 'users'
const created: { collection: Slug; id: number }[] = []

async function createRoomType(pricePerPerson: number) {
  const doc = await payload.create({
    collection: 'room-types',
    data: { name: `Sabit Tipi ${suffix}-${++seq}`, capacity: 4, pricePerPerson, currency: 'USD' },
  })
  created.push({ collection: 'room-types', id: doc.id })
  return doc
}

async function createRoom(roomTypeId: number) {
  const doc = await payload.create({
    collection: 'rooms',
    data: { roomNumber: `S${++seq}-${suffix}`, roomType: roomTypeId },
  })
  created.push({ collection: 'rooms', id: doc.id })
  return doc
}

async function createPilgrim(firstName: string, room?: number) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName, lastName: 'Sabit', gender: 'male', region: regionId, room },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

async function pay(pilgrim: number, amount: number) {
  const doc = await payload.create({
    collection: 'payments',
    data: {
      pilgrim,
      amount,
      cashbox: await cashboxes.of('USD'),
      paidAt: new Date().toISOString(),
      method: 'cash' as const,
    },
    req,
  })
  created.push({ collection: 'payments', id: doc.id })
  return doc
}

const get = (id: number) => payload.findByID({ collection: 'pilgrims', id, depth: 0 })

const raisePrice = (typeId: number, pricePerPerson: number) =>
  payload.update({ collection: 'room-types', id: typeId, data: { pricePerPerson } })

describe('Fiyat sabitleme', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `lock-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
    const region = await payload.create({
      collection: 'regions',
      data: { name: `Sabit Bölgesi ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })
  })

  afterAll(async () => {
    const order: Slug[] = [
      'payments',
      'pilgrims',
      'payment-groups',
      'rooms',
      'room-types',
      'regions',
      'users',
    ]
    for (const collection of order) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
    await cashboxes.cleanup()
  })

  it('ödeme yapanın (tam veya kısmi) ücreti zamdan etkilenmez, ödemeyeninki güncellenir', async () => {
    const type = await createRoomType(1000)
    const room = await createRoom(type.id)
    const full = await createPilgrim('Tam', room.id)
    const partial = await createPilgrim('Kısmi', room.id)
    const none = await createPilgrim('Yok', room.id)
    expect(none.priceLocked).toBe(false)

    await pay(full.id, 1000)
    await pay(partial.id, 300)
    expect((await get(full.id)).priceLocked).toBe(true)
    expect((await get(partial.id)).priceLocked).toBe(true)

    await raisePrice(type.id, 1200)
    expect((await get(full.id)).roomPrice).toBe(1000)
    expect((await get(partial.id)).roomPrice).toBe(1000)
    expect((await get(none.id)).roomPrice).toBe(1200)
  })

  it('ödeme grubunda bir üyenin ödemesi tüm grubu sabitler', async () => {
    const type = await createRoomType(1000)
    const room = await createRoom(type.id)
    const a = await createPilgrim('Anne', room.id)
    const b = await createPilgrim('Baba', room.id)
    const g = await createGroup(req, { name: `Aile ${suffix}`, pilgrims: [a.id, b.id] })
    created.push({ collection: 'payment-groups', id: g.id })

    await pay(a.id, 100)
    expect((await get(b.id)).priceLocked).toBe(true)

    await raisePrice(type.id, 1500)
    expect((await get(a.id)).roomPrice).toBe(1000)
    expect((await get(b.id)).roomPrice).toBe(1000)
  })

  it('sabit kişi aynı tipte odaya taşınınca eski ücreti korur, farklı tipte güncel fiyatı alır', async () => {
    const type = await createRoomType(1000)
    const other = await createRoomType(2000)
    const roomA = await createRoom(type.id)
    const roomB = await createRoom(type.id)
    const roomC = await createRoom(other.id)
    const p = await createPilgrim('Taşınan', roomA.id)
    await pay(p.id, 500)
    await raisePrice(type.id, 1300)

    await payload.update({ collection: 'pilgrims', id: p.id, data: { room: roomB.id }, req })
    expect((await get(p.id)).roomPrice).toBe(1000)

    await payload.update({ collection: 'pilgrims', id: p.id, data: { room: roomC.id }, req })
    const moved = await get(p.id)
    expect(moved.roomPrice).toBe(2000)
    expect(moved.priceLocked).toBe(true)
  })

  it('sabitleme elle kaldırılınca oda tipi kaydında güncel fiyat uygulanır', async () => {
    const type = await createRoomType(1000)
    const room = await createRoom(type.id)
    const p = await createPilgrim('Elle', room.id)
    await pay(p.id, 200)
    await raisePrice(type.id, 1100)
    expect((await get(p.id)).roomPrice).toBe(1000)

    await payload.update({ collection: 'pilgrims', id: p.id, data: { priceLocked: false }, req })
    await raisePrice(type.id, 1100)
    expect((await get(p.id)).roomPrice).toBe(1100)
  })
})
