// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { agencyPilgrimsEndpoint, type AgencyPilgrim } from '@/lib/agency'
import { assignPilgrimsEndpoint, roomBoardEndpoint } from '@/lib/roomBoard'
import type { RoomBoard } from '@/lib/roomBoard'

let payload: Payload
let agencyReq: PayloadRequest
let agencyId: number
let regionId: number
let flightPointId: number
let roomId: number
let placedId: number
let archivedId: number
const suffix = Date.now().toString(36)
const created: {
  collection: 'pilgrims' | 'rooms' | 'room-types' | 'regions' | 'users' | 'flight-points'
  id: number
}[] = []

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const file = (name: string) => ({ data: png, mimetype: 'image/png', name, size: png.length })

const asAgency = { overrideAccess: false } as const

describe('Acente yetkileri', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    const region = await payload.create({
      collection: 'regions',
      data: { name: `Acente Bölge ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })

    const flightPoint = await payload.create({
      collection: 'flight-points',
      data: { name: `Acente Havalimanı ${suffix}`, city: `Acente ${suffix}` },
    })
    flightPointId = flightPoint.id
    created.push({ collection: 'flight-points', id: flightPoint.id })

    const type = await payload.create({
      collection: 'room-types',
      data: {
        name: `Acente 2 Kişilik ${suffix}`,
        capacity: 2,
        pricePerPerson: 900,
        currency: 'USD',
      },
    })
    created.push({ collection: 'room-types', id: type.id })
    const room = await payload.create({
      collection: 'rooms',
      data: { roomNumber: `AC-${suffix}`, roomType: type.id },
    })
    roomId = room.id
    created.push({ collection: 'rooms', id: room.id })

    const placed = await payload.create({
      collection: 'pilgrims',
      data: {
        firstName: 'Acenteli',
        lastName: 'Yerleşik',
        gender: 'male',
        region: regionId,
        flightPoint: flightPointId,
        birthDate: '1980-05-10T00:00:00.000Z',
        phone: '05550000000',
        room: roomId,
      },
    })
    placedId = placed.id
    created.push({ collection: 'pilgrims', id: placed.id })

    const archived = await payload.create({
      collection: 'pilgrims',
      data: {
        firstName: 'Acenteli',
        lastName: 'Arşivli',
        gender: 'female',
        region: regionId,
        archived: true,
      },
    })
    archivedId = archived.id
    created.push({ collection: 'pilgrims', id: archived.id })

    for (const kind of ['idCard', 'other'] as const) {
      await payload.create({
        collection: 'pilgrim-documents',
        data: { pilgrim: placedId, kind },
        file: file(`acente-${kind}-${suffix}.png`),
      })
    }

    const agency = await payload.create({
      collection: 'users',
      data: {
        username: `agency-${suffix}`,
        password: 'test-1234',
        role: 'agency',
        // Acentenin bölgesi ve oda yetkisi olmaz; kayıtta temizlenir.
        regions: [regionId],
        canManageRooms: true,
      },
    })
    agencyId = agency.id
    created.push({ collection: 'users', id: agency.id })
    agencyReq = await createLocalReq({ user: { ...agency, collection: 'users' } }, payload)
  })

  afterAll(async () => {
    // Umreci silinince dokümanları da silinir; oda boşalmadan silinemez.
    for (const collection of [
      'pilgrims',
      'rooms',
      'room-types',
      'users',
      'regions',
      'flight-points',
    ] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('acentenin bölgesi ve oda yerleşimi yetkisi olmaz', async () => {
    const agency = await payload.findByID({ collection: 'users', id: agencyId, depth: 0 })
    expect(agency.role).toBe('agency')
    expect(agency.regions ?? []).toHaveLength(0)
    expect(agency.canManageRooms).toBe(false)
  })

  it('umreci listesinde yalnızca izin verilen alanları görür', async () => {
    const res = await agencyPilgrimsEndpoint.handler(agencyReq)
    const list = (await res.json()) as AgencyPilgrim[]

    expect(list.map((p) => p.id)).not.toContain(archivedId)
    const placed = list.find((p) => p.id === placedId)!
    expect(Object.keys(placed).sort()).toEqual(
      ['birthDate', 'firstName', 'flightPoint', 'id', 'idCard', 'lastName', 'roomNumber'].sort(),
    )
    expect(placed).toMatchObject({
      firstName: 'Acenteli',
      lastName: 'Yerleşik',
      flightPoint: { id: flightPointId },
      roomNumber: `AC-${suffix}`,
    })
    expect(placed.birthDate?.slice(0, 10)).toBe('1980-05-10')
    expect(placed.idCard?.url).toContain('acente-idCard')
  })

  it('umreci listesi giriş yapmamış ve bölge yöneticisine kapalı', async () => {
    const anon = await createLocalReq({}, payload)
    await expect(
      Promise.resolve().then(() => agencyPilgrimsEndpoint.handler(anon)),
    ).rejects.toThrow('giriş')

    const managerReq = await createLocalReq(
      {
        user: { id: -1, role: 'regionManager', regions: [regionId], collection: 'users' } as never,
      },
      payload,
    )
    await expect(
      Promise.resolve().then(() => agencyPilgrimsEndpoint.handler(managerReq)),
    ).rejects.toThrow('yetkiniz yok')
  })

  it('umreci, tahsilat, kasa, ödeme grubu, bölge ve oda koleksiyonlarına erişemez', async () => {
    for (const collection of [
      'pilgrims',
      'payments',
      'cashboxes',
      'payment-groups',
      'payment-receipts',
      'expenses',
      'cash-transfers',
      'regions',
      'rooms',
      'room-types',
    ] as const) {
      await expect(
        payload.find({ collection, req: agencyReq, ...asAgency }),
        collection,
      ).rejects.toThrow()
    }
    await expect(
      payload.findByID({ collection: 'pilgrims', id: placedId, req: agencyReq, ...asAgency }),
    ).rejects.toThrow()
  })

  it('dokümanlardan yalnızca kimlik resmini görür, hiçbirini değiştiremez', async () => {
    const { docs } = await payload.find({
      collection: 'pilgrim-documents',
      where: { pilgrim: { equals: placedId } },
      depth: 0,
      req: agencyReq,
      ...asAgency,
    })
    expect(docs.map((d) => d.kind)).toEqual(['idCard'])

    await expect(
      payload.delete({
        collection: 'pilgrim-documents',
        id: docs[0]!.id,
        req: agencyReq,
        ...asAgency,
      }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'pilgrim-documents',
        data: { pilgrim: placedId, kind: 'other' },
        file: file(`acente-yeni-${suffix}.png`),
        req: agencyReq,
        ...asAgency,
      }),
    ).rejects.toThrow()
  })

  it('oda yerleşimini bölge ve ödeme grubu olmadan görür, kimseyi taşıyamaz', async () => {
    const res = await roomBoardEndpoint.handler(agencyReq)
    const board = (await res.json()) as RoomBoard
    expect(board.rooms.map((r) => r.id)).toContain(roomId)
    const placed = board.pilgrims.find((p) => p.id === placedId)
    expect(placed).toMatchObject({ room: roomId, region: null, paymentGroup: null })
    expect(board.pilgrims.every((p) => p.region === null && p.paymentGroup === null)).toBe(true)

    await expect(
      Promise.resolve().then(() => assignPilgrimsEndpoint.handler(agencyReq)),
    ).rejects.toThrow('yetkiniz yok')
  })

  it('kendi rolünü değiştiremez', async () => {
    await payload
      .update({
        collection: 'users',
        id: agencyId,
        data: { role: 'admin' },
        req: agencyReq,
        ...asAgency,
      })
      .catch(() => undefined)
    const agency = await payload.findByID({ collection: 'users', id: agencyId, depth: 0 })
    expect(agency.role).toBe('agency')
  })
})
