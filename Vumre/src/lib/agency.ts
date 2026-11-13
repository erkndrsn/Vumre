import type { Endpoint, PayloadRequest } from 'payload'

import { isAdmin, isAgency, requireUser } from './access'
import { notArchived, relationId } from './rooms'

type Id = number | string

/**
 * Acentenin gördüğü umreci: yalnızca burada sayılan alanlar. Acentenin umreci koleksiyonuna
 * REST erişimi yoktur; TC/pasaport, iletişim, bölge, ücret ve tahsilat bilgisi buradan çıkmaz.
 */
export interface AgencyPilgrim {
  id: Id
  firstName: string
  lastName: string
  birthDate: string | null
  flightPoint: { id: Id; name: string } | null
  roomNumber: string | null
  idCard: { url: string; thumbnailUrl: string | null; mimeType: string | null } | null
}

export async function getAgencyPilgrims(req: PayloadRequest): Promise<AgencyPilgrim[]> {
  const { docs: pilgrims } = await req.payload.find({
    collection: 'pilgrims',
    where: notArchived,
    select: {
      firstName: true,
      lastName: true,
      fullName: true,
      birthDate: true,
      flightPoint: true,
      room: true,
    },
    sort: 'fullName',
    pagination: false,
    depth: 0,
    req,
  })
  if (!pilgrims.length) return []

  const [flightPoints, rooms, idCards] = await Promise.all([
    req.payload.find({
      collection: 'flight-points',
      select: { name: true },
      pagination: false,
      depth: 0,
      req,
    }),
    req.payload.find({
      collection: 'rooms',
      select: { roomNumber: true },
      pagination: false,
      depth: 0,
      context: { skipOccupancy: true },
      req,
    }),
    req.payload.find({
      collection: 'pilgrim-documents',
      where: {
        kind: { equals: 'idCard' },
        pilgrim: { in: pilgrims.map((p) => p.id) },
      },
      select: { pilgrim: true, url: true, mimeType: true, sizes: true },
      pagination: false,
      depth: 0,
      req,
    }),
  ])

  const flightPointById = new Map(flightPoints.docs.map((f) => [String(f.id), f]))
  const roomById = new Map(rooms.docs.map((r) => [String(r.id), r]))
  const idCardByPilgrim = new Map(idCards.docs.map((d) => [String(relationId(d.pilgrim)), d]))

  return pilgrims.map((p) => {
    const flightPoint = flightPointById.get(String(relationId(p.flightPoint)))
    const room = roomById.get(String(relationId(p.room)))
    const doc = idCardByPilgrim.get(String(p.id))
    return {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: p.birthDate ?? null,
      flightPoint: flightPoint ? { id: flightPoint.id, name: flightPoint.name } : null,
      roomNumber: room?.roomNumber ?? null,
      idCard: doc?.url
        ? {
            url: doc.url,
            thumbnailUrl: doc.sizes?.thumbnail?.url ?? null,
            mimeType: doc.mimeType ?? null,
          }
        : null,
    }
  })
}

export const agencyPilgrimsEndpoint: Endpoint = {
  path: '/agency',
  method: 'get',
  handler: async (req) => {
    requireUser(req, (user) => isAdmin(user) || isAgency(user))
    return Response.json(await getAgencyPilgrims(req))
  },
}
