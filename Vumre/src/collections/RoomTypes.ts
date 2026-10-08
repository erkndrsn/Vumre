import { APIError, ValidationError, type CollectionConfig } from 'payload'

import { CURRENCY_OPTIONS, countOccupants } from '../lib/rooms'

export const RoomTypes: CollectionConfig = {
  slug: 'room-types',
  labels: { singular: 'Oda Tipi', plural: 'Oda Tipleri' },
  admin: {
    useAsTitle: 'name',
    group: 'Konaklama',
    defaultColumns: ['name', 'capacity', 'pricePerPerson', 'currency', 'active'],
  },
  fields: [
    { name: 'name', label: 'Oda tipi adı', type: 'text', required: true, unique: true },
    { name: 'capacity', label: 'Kişi kapasitesi', type: 'number', required: true, min: 1 },
    { name: 'pricePerPerson', label: 'Kişi başı ücret', type: 'number', required: true, min: 0 },
    {
      name: 'currency',
      label: 'Para birimi',
      type: 'select',
      required: true,
      defaultValue: 'USD',
      options: CURRENCY_OPTIONS,
    },
    { name: 'description', label: 'Açıklama', type: 'textarea' },
    { name: 'active', label: 'Aktif', type: 'checkbox', defaultValue: true },
  ],
  hooks: {
    beforeChange: [
      // Kapasite düşürülürken, bu tipteki odalarda yeni kapasiteden fazla kişi kalmamalı.
      async ({ data, originalDoc, operation, req }) => {
        if (operation !== 'update' || data.capacity === undefined) return data
        if (data.capacity >= originalDoc.capacity) return data

        const { docs: rooms } = await req.payload.find({
          collection: 'rooms',
          where: { roomType: { equals: originalDoc.id } },
          pagination: false,
          depth: 0,
          req,
        })
        for (const room of rooms) {
          const occupied = await countOccupants(req, room.id)
          if (occupied > data.capacity) {
            throw new ValidationError({
              collection: 'room-types',
              errors: [
                {
                  path: 'capacity',
                  message: `Oda ${room.roomNumber} içinde ${occupied} kişi var; kapasite ${data.capacity} yapılamaz.`,
                },
              ],
            })
          }
        }
        return data
      },
    ],
    afterChange: [
      // Odaların kapasitesi oda tipinden gelir; tip değişince odaları senkronla.
      async ({ doc, previousDoc, operation, req }) => {
        if (operation !== 'update' || doc.capacity === previousDoc?.capacity) return doc
        await req.payload.update({
          collection: 'rooms',
          where: { roomType: { equals: doc.id } },
          data: { capacity: doc.capacity },
          req,
        })
        return doc
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'rooms',
          where: { roomType: { equals: id } },
          req,
        })
        if (totalDocs > 0) {
          throw new APIError(
            `Bu oda tipine bağlı ${totalDocs} oda var. Önce odaları silin veya oda tipini pasife alın.`,
            400,
            null,
            true,
          )
        }
      },
    ],
  },
}
