import { APIError, ValidationError, type CollectionConfig, type PayloadRequest } from 'payload'

import { adminOnlyAccess } from '../lib/access'
import { CURRENCY_OPTIONS, countOccupants, relationId } from '../lib/rooms'
import {
  ageOn,
  agePriceError,
  otherPriceError,
  otherPricesForAge,
  priceForAge,
  type AgePrice,
  type OtherPrice,
} from '../utils/childPricing'
import type { CurrencyPrice } from '../utils/payments'

type Id = number | string

/** Bu oda tipindeki odalara atanmış umreciler. */
async function assignedPilgrims(req: PayloadRequest, roomTypeId: Id) {
  const { docs: rooms } = await req.payload.find({
    collection: 'rooms',
    where: { roomType: { equals: roomTypeId } },
    select: { roomNumber: true },
    pagination: false,
    depth: 0,
    context: { skipOccupancy: true },
    req,
  })
  if (!rooms.length) return []
  const { docs } = await req.payload.find({
    collection: 'pilgrims',
    where: { room: { in: rooms.map((r) => r.id) } },
    select: {
      fullName: true,
      birthDate: true,
      roomPrice: true,
      roomCurrency: true,
      roomOtherPrices: true,
      paymentGroup: true,
    },
    pagination: false,
    depth: 0,
    req,
  })
  return docs
}

export const RoomTypes: CollectionConfig = {
  slug: 'room-types',
  labels: { singular: 'Oda Tipi', plural: 'Oda Tipleri' },
  access: adminOnlyAccess,
  admin: {
    useAsTitle: 'name',
    group: 'Konaklama',
    defaultColumns: ['name', 'capacity', 'pricePerPerson', 'currency', 'active'],
  },
  fields: [
    { name: 'name', label: 'Oda tipi adı', type: 'text', required: true, unique: true },
    { name: 'capacity', label: 'Kişi kapasitesi', type: 'number', required: true, min: 1 },
    {
      name: 'pricePerPerson',
      label: 'Kişi başı ücret',
      type: 'number',
      required: true,
      min: 0,
      admin: { description: 'Aşağıdaki çocuk yaş aralıklarına girmeyen herkese uygulanır.' },
    },
    {
      name: 'childPrices',
      label: 'Çocuk ücretleri (yaş aralığına göre)',
      labels: { singular: 'Yaş aralığı', plural: 'Yaş aralıkları' },
      type: 'array',
      admin: {
        description:
          'Yaşlar tamamlanmış yaştır ve iki uç dahildir (ör. 2-6 → 2 ile 6 yaş arası). ' +
          'Yaş, odaya atama tarihindeki doğum tarihine göre hesaplanır.',
      },
      validate: (value: unknown) =>
        agePriceError(value as Partial<AgePrice>[] | null | undefined) ?? true,
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'minAge', label: 'Başlangıç yaşı', type: 'number', required: true, min: 0 },
            { name: 'maxAge', label: 'Bitiş yaşı', type: 'number', required: true, min: 0 },
            { name: 'price', label: 'Kişi başı ücret', type: 'number', required: true, min: 0 },
          ],
        },
      ],
    },
    {
      name: 'currency',
      label: 'Para birimi',
      type: 'select',
      required: true,
      defaultValue: 'USD',
      options: CURRENCY_OPTIONS,
    },
    {
      name: 'otherPrices',
      label: 'Diğer para birimlerinde ücret',
      labels: { singular: 'Para birimi', plural: 'Para birimleri' },
      type: 'array',
      admin: {
        description:
          'Ödeme bu para birimlerinde de alınabilir. Borç ana para biriminde tutulur; diğer ' +
          'para birimindeki ödeme, ücretlerin oranıyla borçtan düşülür. Çocuk ücretlerine de ' +
          'aynı oran uygulanır.',
      },
      validate: (value: unknown, { data }: { data: Partial<{ currency: string }> }) =>
        otherPriceError(value as Partial<OtherPrice>[] | null | undefined, data?.currency) ?? true,
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'currency',
              label: 'Para birimi',
              type: 'select',
              required: true,
              options: CURRENCY_OPTIONS,
            },
            {
              name: 'pricePerPerson',
              label: 'Kişi başı ücret',
              type: 'number',
              required: true,
              min: 0,
            },
          ],
        },
      ],
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
      // Para birimi değişirken umrecilerin tahsilatları ve ödeme grupları tutarlı kalmalı.
      async ({ data, originalDoc, operation, req }) => {
        if (operation !== 'update' || data.currency === undefined) return data
        if (data.currency === originalDoc.currency) return data

        const currencyError = (message: string) =>
          new ValidationError({ collection: 'room-types', errors: [{ path: 'currency', message }] })

        const pilgrims = await assignedPilgrims(req, originalDoc.id)
        if (!pilgrims.length) return data
        const ids = pilgrims.map((p) => p.id)

        const { totalDocs } = await req.payload.count({
          collection: 'payments',
          where: { pilgrim: { in: ids }, debtCurrency: { not_equals: data.currency } },
          req,
        })
        if (totalDocs > 0) {
          throw currencyError(
            `Bu oda tipindeki umrecilerin ${originalDoc.currency} cinsinden ${totalDocs} tahsilatı var; para birimi değiştirilemez.`,
          )
        }

        // Ödeme grubunda bu oda tipi dışında kalan biri varsa grup iki para birimine bölünür.
        const groupIds = [
          ...new Set(pilgrims.map((p) => relationId(p.paymentGroup)).filter(Boolean)),
        ]
        if (groupIds.length) {
          const { totalDocs: outsiders } = await req.payload.count({
            collection: 'pilgrims',
            where: {
              paymentGroup: { in: groupIds },
              id: { not_in: ids },
              roomCurrency: { exists: true },
            },
            req,
          })
          if (outsiders > 0) {
            throw currencyError(
              'Bu oda tipindeki umrecilerin ödeme gruplarında başka oda tipinde kalan kişiler var; para birimi değiştirilemez.',
            )
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
      // Umrecinin oda ücreti atamada oda tipinden yazılır; oda tipi her kaydedildiğinde
      // odalardaki umrecilerin ücreti ve para birimleri tipe eşitlenir. Değişiklik aranmaz ki
      // bir şekilde geride kalmış ücretler de tekrar kaydetmekle düzelsin.
      async ({ doc, operation, req }) => {
        if (operation !== 'update') return doc
        const pilgrims = await assignedPilgrims(req, doc.id)
        const key = (prices: CurrencyPrice[] | null | undefined) =>
          JSON.stringify((prices ?? []).map(({ currency, price }) => [currency, price]))
        for (const p of pilgrims) {
          const age = ageOn(p.birthDate)
          const roomPrice = priceForAge(doc, age)
          const roomOtherPrices = otherPricesForAge(doc, age)
          if (
            roomPrice === p.roomPrice &&
            doc.currency === p.roomCurrency &&
            key(roomOtherPrices) === key(p.roomOtherPrices)
          ) {
            continue
          }
          await req.payload.update({
            collection: 'pilgrims',
            id: p.id,
            data: { roomPrice, roomCurrency: doc.currency, roomOtherPrices },
            // Grup para birimi tutarlılığı yukarıda toplu kontrol edildi; üyeler tek tek
            // güncellenirken ara durum hata vermesin.
            context: { roomTypeSync: true },
            req,
          })
        }
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
