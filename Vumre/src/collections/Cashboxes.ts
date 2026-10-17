import { APIError, ValidationError, type CollectionConfig } from 'payload'

import { adminOnlyAccess } from '../lib/access'
import { cashboxBalancesEndpoint, cashboxLedgerEndpoint, hasCashboxMovements } from '../lib/cash'
import { CURRENCY_OPTIONS } from '../lib/rooms'
import { CASHBOX_KIND_OPTIONS } from '../utils/cash'

/**
 * Paranın durduğu yer (nakit kasa, banka hesabı, POS). Her kasa tek para birimlidir; tahsilatlar
 * kasaya girer, giderler kasadan çıkar, virmanla kasalar arası aktarılır. Bakiye saklanmaz,
 * hareketlerden hesaplanır (`GET /api/cashboxes/balances`).
 */
export const Cashboxes: CollectionConfig = {
  slug: 'cashboxes',
  labels: { singular: 'Kasa', plural: 'Kasalar' },
  access: adminOnlyAccess,
  admin: {
    useAsTitle: 'name',
    group: 'Muhasebe',
    defaultColumns: ['name', 'currency', 'kind', 'active'],
  },
  defaultSort: 'name',
  endpoints: [cashboxBalancesEndpoint, cashboxLedgerEndpoint],
  fields: [
    { name: 'name', label: 'Kasa adı', type: 'text', required: true, unique: true },
    {
      type: 'row',
      fields: [
        {
          name: 'currency',
          label: 'Para birimi',
          type: 'select',
          required: true,
          options: CURRENCY_OPTIONS,
          index: true,
          admin: { description: 'Hareketi olan kasanın para birimi değiştirilemez.' },
        },
        {
          name: 'kind',
          label: 'Kasa türü',
          type: 'select',
          required: true,
          defaultValue: 'cash',
          options: CASHBOX_KIND_OPTIONS,
        },
      ],
    },
    {
      name: 'active',
      label: 'Aktif',
      type: 'checkbox',
      defaultValue: true,
      index: true,
      admin: { description: 'Pasif kasaya yeni tahsilat, ödeme veya virman girilemez.' },
    },
    { name: 'note', label: 'Not', type: 'textarea' },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        if (typeof data.name === 'string') data.name = data.name.trim()
        if (
          operation === 'update' &&
          data.currency &&
          data.currency !== originalDoc?.currency &&
          (await hasCashboxMovements(req, originalDoc.id))
        ) {
          throw new ValidationError({
            collection: 'cashboxes',
            errors: [
              {
                path: 'currency',
                message: 'Hareketi olan kasanın para birimi değiştirilemez; yeni kasa açın.',
              },
            ],
          })
        }
        return data
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        if (await hasCashboxMovements(req, id)) {
          throw new APIError(
            'Hareketi olan kasa silinemez; kullanılmayacaksa pasif yapın.',
            400,
            null,
            true,
          )
        }
      },
    ],
  },
}
