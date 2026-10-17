// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getBalances } from '@/lib/payments'
import { assignPilgrims, getRoomBoard } from '@/lib/roomBoard'
import { memberStatus } from '@/utils/payments'

let payload: Payload
let req: PayloadRequest
const suffix = Date.now().toString(36)
let regionId: number
let roomId: number
const created: {
  collection: 'pilgrims' | 'rooms' | 'room-types' | 'regions' | 'users'
  id: number
}[] = []

async function createPilgrim(firstName: string) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName, lastName: 'Arşiv', gender: 'male', region: regionId },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

describe('Umreci arşivi', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `archive-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)

    const region = await payload.create({
      collection: 'regions',
      data: { name: `Arşiv Bölgesi ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })

    const type = await payload.create({
      collection: 'room-types',
      data: {
        name: `Arşiv 2 Kişilik ${suffix}`,
        capacity: 2,
        pricePerPerson: 900,
        currency: 'USD',
      },
    })
    created.push({ collection: 'room-types', id: type.id })
    const room = await payload.create({
      collection: 'rooms',
      data: { roomNumber: `AR-${suffix}`, roomType: type.id },
    })
    roomId = room.id
    created.push({ collection: 'rooms', id: room.id })
  })

  afterAll(async () => {
    for (const collection of ['pilgrims', 'rooms', 'room-types', 'regions', 'users'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('arşive taşınan kişi odasından çıkar ve yeri boşalır', async () => {
    const a = await createPilgrim('Ahmet')
    const b = await createPilgrim('Bekir')
    await assignPilgrims(req, { room: roomId, pilgrims: [a.id, b.id] })

    const archived = await payload.update({
      collection: 'pilgrims',
      id: a.id,
      data: { archived: true, archiveReason: 'Sağlık sorunu' },
    })
    expect(archived.room).toBeNull()
    expect(archived.roomPrice).toBeNull()
    expect(archived.archivedAt).toBeTruthy()

    const room = await payload.findByID({ collection: 'rooms', id: roomId })
    expect(room.occupied).toBe(1)
  })

  it('arşivdeki kişi panoda görünmez ve odaya atanamaz', async () => {
    const c = await createPilgrim('Cemal')
    await payload.update({ collection: 'pilgrims', id: c.id, data: { archived: true } })

    const board = await getRoomBoard(req)
    expect(board.pilgrims.some((p) => p.id === c.id)).toBe(false)

    await expect(assignPilgrims(req, { room: roomId, pilgrims: [c.id] })).rejects.toThrow(
      /Arşivdeki umreciler odaya atanamaz/,
    )
    await expect(
      payload.update({ collection: 'pilgrims', id: c.id, data: { room: roomId } }),
    ).rejects.toThrow()
  })

  it('arşivden çıkan kişi yeniden odaya atanabilir', async () => {
    const d = await createPilgrim('Davut')
    await payload.update({
      collection: 'pilgrims',
      id: d.id,
      data: { archived: true, archiveReason: 'Vize' },
    })
    const restored = await payload.update({
      collection: 'pilgrims',
      id: d.id,
      data: { archived: false },
    })
    expect(restored.archivedAt).toBeNull()
    expect(restored.archiveReason).toBeNull()

    const board = await getRoomBoard(req)
    expect(board.pilgrims.some((p) => p.id === d.id)).toBe(true)
  })

  it('ödemesi olmayan arşivdeki kişi borç listesinde yer almaz', async () => {
    const e = await createPilgrim('Emre')
    await payload.update({ collection: 'pilgrims', id: e.id, data: { archived: true } })
    const balances = await getBalances(req)
    expect(balances.some((b) => b.id === e.id)).toBe(false)
  })

  it('arşivdeki kişinin ödemesi iade edilecek fazla ödemedir', () => {
    expect(memberStatus(null, 500, true)).toBe('overpaid')
    expect(memberStatus(null, 500, false)).toBe('advance')
    expect(memberStatus(null, 0, true)).toBe('unpriced')
  })
})
