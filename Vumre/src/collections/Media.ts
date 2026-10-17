import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Medya', plural: 'Medya' },
  admin: {
    group: 'Yönetim',
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'alt',
      label: 'Alternatif metin',
      type: 'text',
      required: true,
    },
  ],
  upload: true,
}
