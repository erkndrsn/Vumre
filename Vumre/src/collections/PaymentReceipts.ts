import path from 'path'
import { fileURLToPath } from 'url'
import type { CollectionConfig } from 'payload'

import { adminOnlyAccess } from '../lib/access'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Tahsilat dekontları (havale/EFT dekontu, makbuz fotoğrafı vb.). Tahsilata `payment` ilişkisiyle
 * bağlanır; tahsilatın kendisi değişmediği için dekont sonradan eklenirken borç denetimi yeniden
 * çalışmaz. Mali belge olduğu için Media'nın aksine herkese açık değildir: yalnızca admin görür.
 */
export const PaymentReceipts: CollectionConfig = {
  slug: 'payment-receipts',
  labels: { singular: 'Dekont', plural: 'Dekontlar' },
  access: adminOnlyAccess,
  admin: {
    group: 'Muhasebe',
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'payment', 'createdAt'],
  },
  defaultSort: '-createdAt',
  upload: {
    staticDir: path.resolve(dirname, '../../uploads/payment-receipts'),
    mimeTypes: ['image/*', 'application/pdf'],
    imageSizes: [{ name: 'thumbnail', width: 480, withoutEnlargement: true }],
    adminThumbnail: 'thumbnail',
  },
  fields: [
    {
      name: 'payment',
      label: 'Tahsilat',
      type: 'relationship',
      relationTo: 'payments',
      required: true,
      index: true,
    },
  ],
}
