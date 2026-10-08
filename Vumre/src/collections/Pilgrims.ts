import { ValidationError, type CollectionConfig } from 'payload'

import { countOccupants, relationId } from '../lib/rooms'

/** TC Kimlik No algoritma kontrolü (11 hane, ilk hane 0 olamaz, 10. ve 11. hane sağlaması). */
export function isValidTcNo(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = value.split('').map(Number)
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const d10 = (((odd * 7 - even) % 10) + 10) % 10
  const d11 = d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10
  return d[9] === d10 && d[10] === d11
}

export const Pilgrims: CollectionConfig = {
  slug: 'pilgrims',
  labels: { singular: 'Umreci', plural: 'Umreciler' },
  admin: {
    useAsTitle: 'fullName',
    group: 'Konaklama',
    defaultColumns: ['fullName', 'tcNo', 'phone', 'room', 'roomPrice', 'roomCurrency'],
  },
  defaultSort: 'fullName',
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'firstName', label: 'Ad', type: 'text', required: true },
        { name: 'lastName', label: 'Soyad', type: 'text', required: true },
      ],
    },
    {
      name: 'fullName',
      label: 'Ad Soyad',
      type: 'text',
      index: true,
      admin: { hidden: true },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'tcNo',
          label: 'TC Kimlik No',
          type: 'text',
          unique: true,
          validate: (value: string | null | undefined) =>
            !value || isValidTcNo(value) || 'Geçerli bir TC Kimlik No girin.',
        },
        { name: 'passportNo', label: 'Pasaport No', type: 'text', unique: true },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'phone', label: 'Telefon', type: 'text' },
        {
          name: 'birthDate',
          label: 'Doğum tarihi',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'dd.MM.yyyy' } },
        },
        {
          name: 'gender',
          label: 'Cinsiyet',
          type: 'select',
          required: true,
          options: [
            { label: 'Erkek', value: 'male' },
            { label: 'Kadın', value: 'female' },
          ],
        },
      ],
    },
    { name: 'address', label: 'Adres', type: 'textarea' },
    { name: 'description', label: 'Açıklama', type: 'textarea' },
    {
      name: 'room',
      label: 'Oda',
      type: 'relationship',
      relationTo: 'rooms',
      index: true,
      filterOptions: { active: { equals: true } },
      admin: { position: 'sidebar' },
    },
    {
      name: 'roomPrice',
      label: 'Oda ücreti (kişi başı)',
      type: 'number',
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Odaya atandığında oda tipinin kişi başı ücretinden alınır.',
      },
    },
    {
      name: 'roomCurrency',
      label: 'Para birimi',
      type: 'text',
      admin: { position: 'sidebar', readOnly: true },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const firstName = (data.firstName ?? originalDoc?.firstName ?? '').trim()
        const lastName = (data.lastName ?? originalDoc?.lastName ?? '').trim()
        data.fullName = `${firstName} ${lastName}`.trim()

        if (data.room === undefined) return data

        const roomId = relationId(data.room)
        const previousRoomId = relationId(originalDoc?.room)

        if (!roomId) {
          data.room = null
          data.roomPrice = null
          data.roomCurrency = null
          return data
        }
        // Aynı odada kalıyorsa atama anındaki ücret korunur.
        if (String(roomId) === String(previousRoomId)) return data

        const roomError = (message: string) =>
          new ValidationError({ collection: 'pilgrims', errors: [{ path: 'room', message }] })

        const room = await req.payload.findByID({
          collection: 'rooms',
          id: roomId,
          depth: 1,
          req,
        })
        const roomType = typeof room.roomType === 'object' ? room.roomType : null
        if (!roomType) throw roomError('Odanın oda tipi bulunamadı.')
        if (!room.active || !roomType.active) {
          throw roomError(`Oda ${room.roomNumber} pasif durumda, atama yapılamaz.`)
        }

        const capacity = room.capacity ?? roomType.capacity
        const occupied = await countOccupants(req, roomId, originalDoc?.id)
        if (occupied >= capacity) {
          throw roomError(
            `Oda ${room.roomNumber} dolu (${occupied}/${capacity}). Bu odaya daha fazla kişi atanamaz.`,
          )
        }

        data.roomPrice = roomType.pricePerPerson
        data.roomCurrency = roomType.currency
        return data
      },
    ],
  },
}
