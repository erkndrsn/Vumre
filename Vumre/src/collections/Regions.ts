import { APIError, type CollectionConfig } from 'payload'

import { adminOnly, isAdmin, isRegionManager } from '../lib/access'

export const Regions: CollectionConfig = {
  slug: 'regions',
  labels: { singular: 'Bölge', plural: 'Bölgeler' },
  access: {
    // Bölge yöneticisi tüm umrecileri gördüğü için bölge adlarını da görür; sorumlu olduğu
    // bölgeler kullanıcı kaydındaki `regions` alanındadır.
    read: ({ req }) => isAdmin(req.user) || isRegionManager(req.user),
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    group: 'Konaklama',
    defaultColumns: ['name', 'defaultFlightPoint', 'description', 'active'],
  },
  defaultSort: 'name',
  fields: [
    { name: 'name', label: 'Bölge adı', type: 'text', required: true, unique: true },
    {
      name: 'defaultFlightPoint',
      label: 'Uçuş noktası',
      type: 'relationship',
      relationTo: 'flight-points',
      filterOptions: { active: { equals: true } },
      admin: {
        description:
          'Bu bölgeden kaydedilen umrecilere varsayılan olarak atanır. Havalimanı olmayan bölgeler için en yakın nokta seçilir (ör. Aydın → İzmir).',
      },
    },
    { name: 'description', label: 'Açıklama', type: 'textarea' },
    { name: 'active', label: 'Aktif', type: 'checkbox', defaultValue: true },
  ],
  hooks: {
    beforeDelete: [
      async ({ id, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'pilgrims',
          where: { region: { equals: id } },
          req,
        })
        if (totalDocs > 0) {
          throw new APIError(
            `Bu bölgeye kayıtlı ${totalDocs} umreci var. Silmek yerine bölgeyi pasife alın.`,
            400,
            null,
            true,
          )
        }
      },
    ],
  },
}
