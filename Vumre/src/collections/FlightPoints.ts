import { APIError, type CollectionConfig } from 'payload'

import { loggedInReadAdminWrite } from '../lib/access'

/**
 * Umrecilerin yolculuğa başladığı havalimanları. Genel uçuş ana noktadan (ör. İstanbul)
 * kalkar; diğer noktalardan (Kayseri, İzmir…) ana noktaya aktarmalı gelinir. Havalimanı
 * olmayan bölgeler (ör. Aydın) en yakın noktaya bağlanır; bölgenin varsayılanı olarak seçilir.
 */
export const FlightPoints: CollectionConfig = {
  slug: 'flight-points',
  labels: { singular: 'Uçuş noktası', plural: 'Uçuş noktaları' },
  access: loggedInReadAdminWrite,
  admin: {
    useAsTitle: 'name',
    group: 'Konaklama',
    defaultColumns: ['name', 'city', 'airportCode', 'isMain', 'active'],
  },
  defaultSort: 'name',
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          label: 'Uçuş noktası adı',
          type: 'text',
          required: true,
          unique: true,
          admin: { description: 'Ör. İzmir Adnan Menderes Havalimanı' },
        },
        { name: 'city', label: 'Şehir', type: 'text', required: true },
        {
          name: 'airportCode',
          label: 'Havalimanı kodu',
          type: 'text',
          admin: { description: 'IATA kodu, ör. ADB, ASR, IST' },
        },
      ],
    },
    {
      name: 'isMain',
      label: 'Ana uçuş noktası',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Genel uçuşun kalktığı nokta (ör. İstanbul). Diğer noktalardan buraya aktarmalı gelinir. Yalnızca bir nokta ana olabilir.',
      },
    },
    { name: 'description', label: 'Açıklama', type: 'textarea' },
    { name: 'active', label: 'Aktif', type: 'checkbox', defaultValue: true },
  ],
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (typeof data.airportCode === 'string') {
          data.airportCode = data.airportCode.trim().toLocaleUpperCase('tr') || null
        }
        return data
      },
    ],
    afterChange: [
      // Tek ana nokta: yeni ana nokta seçilince öncekinin işareti kalkar.
      async ({ doc, previousDoc, req }) => {
        if (!doc.isMain || previousDoc?.isMain) return doc
        await req.payload.update({
          collection: 'flight-points',
          where: { and: [{ isMain: { equals: true } }, { id: { not_equals: doc.id } }] },
          data: { isMain: false },
          req,
        })
        return doc
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const [pilgrims, regions] = await Promise.all([
          req.payload.count({
            collection: 'pilgrims',
            where: { flightPoint: { equals: id } },
            req,
          }),
          req.payload.count({
            collection: 'regions',
            where: { defaultFlightPoint: { equals: id } },
            req,
          }),
        ])
        if (pilgrims.totalDocs > 0) {
          throw new APIError(
            `Bu uçuş noktasına bağlı ${pilgrims.totalDocs} umreci var. Silmek yerine pasife alın.`,
            400,
            null,
            true,
          )
        }
        if (regions.totalDocs > 0) {
          throw new APIError(
            `Bu uçuş noktası ${regions.totalDocs} bölgenin varsayılanı. Önce bölgelerden kaldırın.`,
            400,
            null,
            true,
          )
        }
      },
    ],
  },
}
