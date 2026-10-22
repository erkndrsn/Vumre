// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assignPilgrims, assignPilgrimsEndpoint, roomBoardEndpoint } from '@/lib/roomBoard'

let payload: Payload
let managerReq: PayloadRequest
let managerId: number
const suffix = Date.now().toString(36)
let ownRegion: number
let otherRegion: number
let roomId: number
const created: {
  collection: 'pilgrims' | 'rooms' | 'room-types' | 'regions' | 'users'
  id: number
}[] = []

async function createPilgrim(firstName: string, region: number) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName, lastName: 'Bölgeli', gender: 'male', region },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

/** Bölge yöneticisi gibi REST/yerel API çağrısı (erişim kuralları uygulanır). */
const asManager = { overrideAccess: false } as const

describe('Bölge yöneticisi yetkileri', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    for (const name of ['Kendi', 'Diğer']) {
      const region = await payload.create({
        collection: 'regions',
        data: { name: `${name} Bölge ${suffix}` },
      })
      created.push({ collection: 'regions', id: region.id })
      if (name === 'Kendi') ownRegion = region.id
      else otherRegion = region.id
    }

    const type = await payload.create({
      collection: 'room-types',
      data: {
        name: `Yönetici 2 Kişilik ${suffix}`,
        capacity: 2,
        pricePerPerson: 900,
        currency: 'USD',
      },
    })
    created.push({ collection: 'room-types', id: type.id })
    const room = await payload.create({
      collection: 'rooms',
      data: { roomNumber: `BY-${suffix}`, roomType: type.id },
    })
    roomId = room.id
    created.push({ collection: 'rooms', id: room.id })

    const manager = await payload.create({
      collection: 'users',
      data: {
        username: `manager-${suffix}`,
        password: 'test-1234',
        role: 'regionManager',
        regions: [ownRegion],
      },
    })
    managerId = manager.id
    created.push({ collection: 'users', id: manager.id })
    managerReq = await createLocalReq({ user: { ...manager, collection: 'users' } }, payload)
  })

  afterAll(async () => {
    for (const collection of ['pilgrims', 'rooms', 'room-types', 'users', 'regions'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('bölge yöneticisi en az bir bölgeyle oluşturulur', async () => {
    await expect(
      payload.create({
        collection: 'users',
        data: {
          username: `no-region-${suffix}`,
          password: 'test-1234',
          role: 'regionManager',
        },
      }),
    ).rejects.toThrow()
  })

  it('tüm bölgelerdeki umrecileri ve bölgeleri görür', async () => {
    const own = await createPilgrim('Kendi', ownRegion)
    const other = await createPilgrim('Diğer', otherRegion)

    const { docs } = await payload.find({
      collection: 'pilgrims',
      where: { id: { in: [own.id, other.id] } },
      sort: 'id',
      req: managerReq,
      ...asManager,
    })
    expect(docs.map((d) => d.id)).toEqual([own.id, other.id])

    const found = await payload.findByID({
      collection: 'pilgrims',
      id: other.id,
      depth: 1,
      req: managerReq,
      ...asManager,
    })
    expect(typeof found.region === 'object' && found.region?.id).toBe(otherRegion)

    const regions = await payload.find({
      collection: 'regions',
      where: { id: { in: [ownRegion, otherRegion] } },
      req: managerReq,
      ...asManager,
    })
    expect(regions.docs.map((r) => r.id).sort()).toEqual([ownRegion, otherRegion].sort())
  })

  it('başka bölgedeki umrecinin dokümanlarına erişemez', async () => {
    const other = await createPilgrim('Dokümansız', otherRegion)
    const { docs } = await payload.find({
      collection: 'pilgrim-documents',
      where: { pilgrim: { equals: other.id } },
      req: managerReq,
      ...asManager,
    })
    expect(docs).toHaveLength(0)
  })

  it('kendi bölgesindeki umrecinin kişi bilgilerini günceller, oda ve arşivi değiştiremez', async () => {
    const own = await createPilgrim('Güncel', ownRegion)

    const updated = await payload.update({
      collection: 'pilgrims',
      id: own.id,
      data: { phone: '05551112233', room: roomId, archived: true },
      req: managerReq,
      ...asManager,
    })
    expect(updated.phone).toBe('05551112233')
    expect(updated.room ?? null).toBeNull()
    expect(updated.archived).toBe(false)
  })

  it('odaya yerleşmiş umrecinin kişi bilgilerini günceller, oda korunur', async () => {
    const own = await createPilgrim('Odalı', ownRegion)
    await payload.update({ collection: 'pilgrims', id: own.id, data: { room: roomId } })

    const updated = await payload.update({
      collection: 'pilgrims',
      id: own.id,
      data: { phone: '05554443322', room: roomId },
      req: managerReq,
      ...asManager,
    })
    expect(updated.phone).toBe('05554443322')
    expect(updated.room).toBe(roomId)
    await payload.update({ collection: 'pilgrims', id: own.id, data: { room: null } })
  })

  it('başka bölgedeki umreciyi güncelleyemez ve umreciyi başka bölgeye taşıyamaz', async () => {
    const own = await createPilgrim('Taşınan', ownRegion)
    const other = await createPilgrim('Yabancı', otherRegion)

    await expect(
      payload.update({
        collection: 'pilgrims',
        id: other.id,
        data: { phone: '0000' },
        req: managerReq,
        ...asManager,
      }),
    ).rejects.toThrow()

    await expect(
      payload.update({
        collection: 'pilgrims',
        id: own.id,
        data: { region: otherRegion },
        req: managerReq,
        ...asManager,
      }),
    ).rejects.toThrow('region')
  })

  it('kendi bölgesine umreci ekler; oda, ödeme grubu ve arşiv alanları yok sayılır', async () => {
    const doc = await payload.create({
      collection: 'pilgrims',
      data: {
        firstName: 'Yeni',
        lastName: 'Kişi',
        gender: 'male',
        region: ownRegion,
        room: roomId,
        archived: true,
        roomPrice: 1,
      },
      req: managerReq,
      ...asManager,
    })
    created.push({ collection: 'pilgrims', id: doc.id })
    expect(doc.room ?? null).toBeNull()
    expect(doc.archived ?? false).toBe(false)
    expect(doc.roomPrice ?? null).toBeNull()

    // Arşivde olmayanlar listesinde (oda yerleşimi, bölge listesi) görünür.
    const { docs } = await payload.find({
      collection: 'pilgrims',
      where: { and: [{ id: { equals: doc.id } }, { archived: { not_equals: true } }] },
    })
    expect(docs).toHaveLength(1)

    await expect(
      payload.create({
        collection: 'pilgrims',
        data: { firstName: 'Yabancı', lastName: 'Kişi', gender: 'male', region: otherRegion },
        req: managerReq,
        ...asManager,
      }),
    ).rejects.toThrow('region')
  })

  it('umreci silemez; tahsilat ve oda verilerine erişemez', async () => {
    const own = await createPilgrim('Silinmez', ownRegion)

    await expect(
      payload.delete({ collection: 'pilgrims', id: own.id, req: managerReq, ...asManager }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'payments', req: managerReq, ...asManager }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'rooms', req: managerReq, ...asManager }),
    ).rejects.toThrow()
  })

  it('oda yerleşimini görüntüler; yetki verilmeden kimseyi taşıyamaz', async () => {
    const other = await createPilgrim('Panoda', otherRegion)

    const res = await roomBoardEndpoint.handler(managerReq)
    const board = await res.json()
    expect(board.rooms.map((r: { id: number }) => r.id)).toContain(roomId)
    expect(board.pilgrims.map((p: { id: number }) => p.id)).toContain(other.id)

    await expect(
      Promise.resolve().then(() => assignPilgrimsEndpoint.handler(managerReq)),
    ).rejects.toThrow('yetkiniz yok')
  })

  it('yetki verilince her bölgeden kişiyi odaya yerleştirir ve odadan çıkarır', async () => {
    const own = await createPilgrim('Yerleşen', ownRegion)
    const other = await createPilgrim('Komşu', otherRegion)
    const manager = await payload.update({
      collection: 'users',
      id: managerId,
      data: { canManageRooms: true },
    })
    const req = await createLocalReq({ user: { ...manager, collection: 'users' } }, payload)

    try {
      // Endpoint yetkiyi geçer, gövde boş olduğu için doğrulamada durur.
      await expect(
        Promise.resolve().then(() => assignPilgrimsEndpoint.handler(req)),
      ).rejects.toThrow('Atanacak umrecileri seçin')

      await assignPilgrims(req, { room: roomId, pilgrims: [own.id, other.id] })
      const placed = await payload.find({
        collection: 'pilgrims',
        where: { id: { in: [own.id, other.id] } },
        depth: 0,
      })
      expect(placed.docs.map((p) => p.room)).toEqual([roomId, roomId])
      // Ücret oda tipinden yazılır; bölge değişmez.
      expect(placed.docs.map((p) => p.roomPrice)).toEqual([900, 900])
      expect(placed.docs.find((p) => p.id === other.id)?.region).toBe(otherRegion)

      await assignPilgrims(req, { room: null, pilgrims: [other.id] })
      const removed = await payload.findByID({ collection: 'pilgrims', id: other.id, depth: 0 })
      expect(removed.room ?? null).toBeNull()

      // Oda yetkisi kişi bilgisi yetkisi vermez.
      await expect(
        payload.update({
          collection: 'pilgrims',
          id: other.id,
          data: { phone: '0000' },
          req,
          ...asManager,
        }),
      ).rejects.toThrow()
    } finally {
      await payload.update({
        collection: 'pilgrims',
        where: { id: { in: [own.id, other.id] } },
        data: { room: null },
      })
      await payload.update({ collection: 'users', id: managerId, data: { canManageRooms: false } })
    }
  })

  it('kendi rolünü, bölgelerini ve oda yerleşimi yetkisini değiştiremez', async () => {
    const self = await payload.update({
      collection: 'users',
      id: managerId,
      data: {
        name: 'Bölge Sorumlusu',
        role: 'admin',
        regions: [ownRegion, otherRegion],
        canManageRooms: true,
      },
      req: managerReq,
      ...asManager,
    })
    expect(self.name).toBe('Bölge Sorumlusu')
    expect(self.role).toBe('regionManager')
    expect(self.regions?.map((r) => (typeof r === 'object' ? r.id : r))).toEqual([ownRegion])
    expect(self.canManageRooms ?? false).toBe(false)
  })
})
