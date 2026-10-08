import { APIError, ValidationError, type CollectionConfig } from 'payload'

import { ROOM_STATUS_OPTIONS, countOccupants, relationId, roomStatus } from '../lib/rooms'

export const Rooms: CollectionConfig = {
  slug: 'rooms',
  labels: { singular: 'Oda', plural: 'Odalar' },
  admin: {
    useAsTitle: 'roomNumber',
    group: 'Konaklama',
    defaultColumns: ['roomNumber', 'roomType', 'capacity', 'occupied', 'status', 'active'],
  },
  defaultSort: 'roomNumber',
  fields: [
    { name: 'roomNumber', label: 'Oda numarası', type: 'text', required: true, unique: true },
    {
      name: 'roomType',
      label: 'Oda tipi',
      type: 'relationship',
      relationTo: 'room-types',
      required: true,
      index: true,
      filterOptions: { active: { equals: true } },
    },
    {
      name: 'capacity',
      label: 'Kapasite',
      type: 'number',
      admin: { readOnly: true, description: 'Oda tipinden otomatik alınır.' },
    },
    {
      name: 'occupied',
      label: 'Dolu yatak',
      type: 'number',
      virtual: true,
      admin: { readOnly: true },
    },
    {
      name: 'status',
      label: 'Durum',
      type: 'select',
      virtual: true,
      options: ROOM_STATUS_OPTIONS,
      admin: { readOnly: true },
    },
    { name: 'active', label: 'Aktif', type: 'checkbox', defaultValue: true },
    { name: 'description', label: 'Açıklama', type: 'textarea' },
    {
      name: 'occupants',
      label: 'Odadaki umreciler',
      type: 'join',
      collection: 'pilgrims',
      on: 'room',
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const roomTypeId = relationId(data.roomType ?? originalDoc?.roomType)
        if (!roomTypeId) return data

        const roomType = await req.payload.findByID({
          collection: 'room-types',
          id: roomTypeId,
          depth: 0,
          req,
        })
        data.capacity = roomType.capacity

        if (originalDoc?.id !== undefined) {
          const occupied = await countOccupants(req, originalDoc.id)
          if (occupied > roomType.capacity) {
            throw new ValidationError({
              collection: 'rooms',
              errors: [
                {
                  path: 'roomType',
                  message: `Odada ${occupied} kişi var; ${roomType.capacity} kişilik tipe geçirilemez.`,
                },
              ],
            })
          }
        }
        return data
      },
    ],
    afterRead: [
      async ({ doc, req }) => {
        const occupied = await countOccupants(req, doc.id)
        doc.occupied = occupied
        doc.status = roomStatus(occupied, doc.capacity ?? 0)
        return doc
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const occupied = await countOccupants(req, id)
        if (occupied > 0) {
          throw new APIError(
            `Odada ${occupied} umreci var. Silmeden önce umrecileri başka odaya taşıyın.`,
            400,
            null,
            true,
          )
        }
      },
    ],
  },
}
