import path from 'path'
import { fileURLToPath } from 'url'
import { ValidationError, type CollectionConfig } from 'payload'

import { adminOrManagedRegion, isAdmin, managedRegionIds } from '../lib/access'
import { relationId } from '../lib/rooms'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Umrecinin kimlik resmi ve diğer dokümanları (pasaport, vize, sağlık raporu vb.).
 * Kişisel veri olduğu için Media'nın aksine herkese açık değildir: dosyayı yalnızca admin ve
 * umrecinin bölgesinden sorumlu bölge yöneticisi görebilir.
 */
export const PilgrimDocuments: CollectionConfig = {
  slug: 'pilgrim-documents',
  labels: { singular: 'Umreci dokümanı', plural: 'Umreci dokümanları' },
  access: {
    read: adminOrManagedRegion('pilgrim.region'),
    update: adminOrManagedRegion('pilgrim.region'),
    delete: adminOrManagedRegion('pilgrim.region'),
    // Seçilen umrecinin yöneticinin bölgesinde olduğu beforeChange'de denetlenir.
    create: ({ req }) => isAdmin(req.user) || managedRegionIds(req.user).length > 0,
  },
  admin: {
    group: 'Konaklama',
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'pilgrim', 'kind', 'note', 'createdAt'],
  },
  defaultSort: '-createdAt',
  upload: {
    staticDir: path.resolve(dirname, '../../uploads/pilgrim-documents'),
    mimeTypes: ['image/*', 'application/pdf'],
    imageSizes: [{ name: 'thumbnail', width: 480, withoutEnlargement: true }],
    adminThumbnail: 'thumbnail',
  },
  fields: [
    {
      name: 'pilgrim',
      label: 'Umreci',
      type: 'relationship',
      relationTo: 'pilgrims',
      required: true,
      index: true,
    },
    {
      name: 'kind',
      label: 'Tür',
      type: 'select',
      required: true,
      defaultValue: 'other',
      options: [
        { label: 'Kimlik', value: 'idCard' },
        { label: 'Diğer doküman', value: 'other' },
      ],
    },
    { name: 'note', label: 'Açıklama', type: 'text' },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        if (!req.user || isAdmin(req.user)) return data
        const pilgrimId = relationId(data.pilgrim ?? originalDoc?.pilgrim)
        const pilgrim = pilgrimId
          ? await req.payload
              .findByID({ collection: 'pilgrims', id: pilgrimId, depth: 0, req })
              .catch(() => null)
          : null
        const regionId = relationId(pilgrim?.region)
        if (!managedRegionIds(req.user).some((id) => String(id) === String(regionId))) {
          throw new ValidationError({
            collection: 'pilgrim-documents',
            errors: [
              {
                path: 'pilgrim',
                message:
                  'Yalnızca sorumlu olduğunuz bölgelerdeki umrecilere doküman ekleyebilirsiniz.',
              },
            ],
          })
        }
        return data
      },
    ],
    afterChange: [
      // Her umrecinin tek kimlik resmi olur; yenisi yüklenince eskisi (dosyasıyla) silinir.
      async ({ doc, req }) => {
        if (doc.kind !== 'idCard') return doc
        await req.payload.delete({
          collection: 'pilgrim-documents',
          where: {
            pilgrim: { equals: relationId(doc.pilgrim) },
            kind: { equals: 'idCard' },
            id: { not_equals: doc.id },
          },
          req,
        })
        return doc
      },
    ],
  },
}
