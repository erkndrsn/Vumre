import {
  addDataAndFileToRequest,
  APIError,
  commitTransaction,
  initTransaction,
  killTransaction,
  type Endpoint,
  type PayloadRequest,
} from 'payload'

import { ageOn, isInfant } from '../utils/childPricing'
import { notArchived, relationId } from './rooms'
import { canManageRooms, isAdmin, isRegionManager, requireAdmin, requireUser } from './access'

/** Oda yerleşimini admin ve tüm bölge yöneticileri görür. */
const canViewBoard = (user: unknown) => isAdmin(user) || isRegionManager(user)

export const MAX_BULK_ROOMS = 500
export const MAX_ASSIGN = 200

type Id = number | string

export interface BoardRoom {
  id: Id
  roomNumber: string
  capacity: number
  active: boolean
  description: string | null
  roomType: { id: Id; name: string; active: boolean } | null
}

export interface BoardPilgrim {
  id: Id
  fullName: string
  gender: 'male' | 'female'
  region: { id: Id; name: string } | null
  room: Id | null
  /** Bugünkü tamamlanmış yaş; doğum tarihi yoksa null. */
  age: number | null
  /** 0-1 yaş; kapasiteden yer tutmaz. */
  infant: boolean
  paymentGroup: { id: Id; name: string } | null
}

/** Yerleşim panosunun tüm verisi: odalar ve umreciler; doluluk istemcide `room` alanından sayılır. */
export interface RoomBoard {
  rooms: BoardRoom[]
  pilgrims: BoardPilgrim[]
}

export interface BulkRoomsResult {
  created: string[]
  /** Aynı numarada zaten oda olduğu için atlananlar. */
  skipped: string[]
}

const badRequest = (message: string) => new APIError(message, 400, null, true)

/**
 * Pano verisini sabit sayıda sorguyla toplar. Odaların `afterRead` hook'u oda başına
 * sayım yaptığından `skipOccupancy` ile kapatılır; umreciler de odayı populate etmez.
 * Odalar, oda tipleri ve ödeme grubu adları bölge yöneticisine koleksiyon olarak kapalıdır;
 * panoda yalnızca burada seçilen alanlarıyla görünür (endpoint erişimi ayrıca denetler).
 */
export async function getRoomBoard(req: PayloadRequest): Promise<RoomBoard> {
  const [rooms, pilgrims, regions, groups] = await Promise.all([
    req.payload.find({
      collection: 'rooms',
      sort: 'roomNumber',
      pagination: false,
      depth: 1,
      context: { skipOccupancy: true },
      req,
    }),
    req.payload.find({
      collection: 'pilgrims',
      where: notArchived,
      select: {
        fullName: true,
        gender: true,
        region: true,
        room: true,
        birthDate: true,
        paymentGroup: true,
      },
      sort: 'fullName',
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
    req.payload.find({
      collection: 'regions',
      select: { name: true },
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
    req.payload.find({
      collection: 'payment-groups',
      select: { name: true },
      pagination: false,
      depth: 0,
      req,
    }),
  ])

  const regionById = new Map(regions.docs.map((r) => [String(r.id), r]))
  const groupById = new Map(groups.docs.map((g) => [String(g.id), g]))

  return {
    rooms: rooms.docs.map((r) => {
      const type = typeof r.roomType === 'object' ? r.roomType : null
      return {
        id: r.id,
        roomNumber: r.roomNumber,
        capacity: r.capacity ?? type?.capacity ?? 0,
        active: r.active !== false,
        description: r.description ?? null,
        roomType: type ? { id: type.id, name: type.name, active: type.active !== false } : null,
      }
    }),
    pilgrims: pilgrims.docs.map((p) => {
      const regionId = relationId(p.region)
      const region = regionId !== null ? regionById.get(String(regionId)) : undefined
      const groupId = relationId(p.paymentGroup)
      const group = groupId !== null ? groupById.get(String(groupId)) : undefined
      return {
        id: p.id,
        fullName: p.fullName ?? '',
        gender: p.gender,
        region: region ? { id: region.id, name: region.name } : null,
        room: relationId(p.room),
        age: ageOn(p.birthDate),
        infant: isInfant(p.birthDate),
        paymentGroup: group ? { id: group.id, name: group.name } : null,
      }
    }),
  }
}

/** Verilen oda numaralarını aynı tipte oluşturur; zaten var olan numaraları atlar. */
export async function createRooms(
  req: PayloadRequest,
  input: { roomType?: unknown; roomNumbers?: unknown },
): Promise<BulkRoomsResult> {
  const roomTypeId = relationId(input.roomType)
  if (!roomTypeId) throw badRequest('Oda tipi seçin.')
  if (!Array.isArray(input.roomNumbers)) throw badRequest('Oda numaralarını girin.')

  const roomNumbers = [
    ...new Set(input.roomNumbers.map((n) => String(n ?? '').trim()).filter(Boolean)),
  ]
  if (!roomNumbers.length) throw badRequest('Oda numaralarını girin.')
  if (roomNumbers.length > MAX_BULK_ROOMS) {
    throw badRequest(`Tek seferde en fazla ${MAX_BULK_ROOMS} oda oluşturulabilir.`)
  }

  const roomType = await req.payload
    .findByID({ collection: 'room-types', id: roomTypeId, depth: 0, req })
    .catch(() => null)
  if (!roomType) throw badRequest('Oda tipi bulunamadı.')
  if (roomType.active === false) throw badRequest(`${roomType.name} oda tipi pasif.`)

  const { docs: existing } = await req.payload.find({
    collection: 'rooms',
    where: { roomNumber: { in: roomNumbers } },
    select: { roomNumber: true },
    pagination: false,
    depth: 0,
    context: { skipOccupancy: true },
    req,
  })
  const taken = new Set(existing.map((r) => r.roomNumber))
  const result: BulkRoomsResult = { created: [], skipped: [] }

  const ownsTransaction = await initTransaction(req)
  try {
    for (const roomNumber of roomNumbers) {
      if (taken.has(roomNumber)) {
        result.skipped.push(roomNumber)
        continue
      }
      await req.payload.create({
        collection: 'rooms',
        data: { roomNumber, roomType: roomType.id },
        context: { skipOccupancy: true },
        overrideAccess: false,
        req,
      })
      result.created.push(roomNumber)
    }
    if (ownsTransaction) await commitTransaction(req)
  } catch (error) {
    if (ownsTransaction) await killTransaction(req)
    throw error
  }
  return result
}

/**
 * Umrecileri bir odaya toplu atar (`room: null` ise odadan çıkarır). Kapasite ve oda
 * durumu yazmadan önce bir kerede kontrol edilir; ücret ataması Pilgrims hook'unda yapılır.
 * Bebekler (0-1 yaş) kapasiteden yer tutmaz.
 */
export async function assignPilgrims(
  req: PayloadRequest,
  input: { room?: unknown; pilgrims?: unknown },
): Promise<{ updated: number }> {
  if (!Array.isArray(input.pilgrims) || !input.pilgrims.length) {
    throw badRequest('Atanacak umrecileri seçin.')
  }
  const ids = [...new Set(input.pilgrims.map((id) => relationId(id)))].filter(
    (id): id is Id => id !== null,
  )
  if (ids.length > MAX_ASSIGN) {
    throw badRequest(`Tek seferde en fazla ${MAX_ASSIGN} kişi taşınabilir.`)
  }

  const { docs: pilgrims } = await req.payload.find({
    collection: 'pilgrims',
    where: { id: { in: ids } },
    select: { room: true, birthDate: true, fullName: true, archived: true },
    pagination: false,
    depth: 0,
    req,
  })
  if (pilgrims.length !== ids.length) {
    throw badRequest('Seçilen umrecilerden bazıları bulunamadı. Sayfayı yenileyin.')
  }
  const archived = pilgrims.filter((p) => p.archived)
  if (archived.length && relationId(input.room) !== null) {
    throw badRequest(
      `Arşivdeki umreciler odaya atanamaz: ${archived.map((p) => p.fullName).join(', ')}.`,
    )
  }

  const roomId = relationId(input.room)
  if (roomId !== null) {
    const room = await req.payload
      .findByID({
        collection: 'rooms',
        id: roomId,
        depth: 1,
        context: { skipOccupancy: true },
        req,
      })
      .catch(() => null)
    if (!room) throw badRequest('Oda bulunamadı.')
    const roomType = typeof room.roomType === 'object' ? room.roomType : null
    if (!room.active || roomType?.active === false) {
      throw badRequest(`Oda ${room.roomNumber} pasif durumda, atama yapılamaz.`)
    }

    const capacity = room.capacity ?? roomType?.capacity ?? 0
    const { docs: others } = await req.payload.find({
      collection: 'pilgrims',
      where: { room: { equals: roomId }, id: { not_in: ids } },
      select: { birthDate: true },
      pagination: false,
      depth: 0,
      req,
    })
    const staying = others.filter((p) => !isInfant(p.birthDate)).length
    const needBeds = pilgrims.filter((p) => !isInfant(p.birthDate)).length
    if (needBeds && staying + needBeds > capacity) {
      const free = Math.max(0, capacity - staying)
      throw badRequest(
        `Oda ${room.roomNumber} için yatak gereken ${needBeds} kişi seçildi ama ${free} boş yer var (${staying}/${capacity}).`,
      )
    }
  }

  const toMove = pilgrims.filter((p) => String(relationId(p.room)) !== String(roomId))

  // Yetki endpoint'te denetlenir (`canManageRooms`). Oda alanı ve başka bölgedeki umreciler
  // bölge yöneticisine REST'te kapalı olduğu için güncelleme erişim kuralları dışında yapılır;
  // yalnızca `room` yazılır, ücret ve kapasite kuralları yine Pilgrims hook'larında işler.
  const ownsTransaction = await initTransaction(req)
  try {
    for (const p of toMove) {
      await req.payload.update({
        collection: 'pilgrims',
        id: p.id,
        data: { room: roomId as number | null },
        depth: 0,
        context: { roomAssignment: true },
        req,
      })
    }
    if (ownsTransaction) await commitTransaction(req)
  } catch (error) {
    if (ownsTransaction) await killTransaction(req)
    throw error
  }
  return { updated: toMove.length }
}

export const roomBoardEndpoint: Endpoint = {
  path: '/board',
  method: 'get',
  handler: async (req) => {
    requireUser(req, canViewBoard)
    return Response.json(await getRoomBoard(req))
  },
}

/** Gövde: `{ roomType, roomNumbers: string[] }` */
export const bulkCreateRoomsEndpoint: Endpoint = {
  path: '/bulk',
  method: 'post',
  handler: async (req) => {
    requireAdmin(req)
    await addDataAndFileToRequest(req)
    return Response.json(await createRooms(req, req.data ?? {}))
  },
}

/** Gövde: `{ room: id | null, pilgrims: id[] }` */
export const assignPilgrimsEndpoint: Endpoint = {
  path: '/assign',
  method: 'post',
  handler: async (req) => {
    requireUser(req, canManageRooms)
    await addDataAndFileToRequest(req)
    return Response.json(await assignPilgrims(req, req.data ?? {}))
  },
}
