import { ValidationError, type CollectionConfig } from 'payload'

import { adminOnlyAccess } from '../lib/access'
import { loadCashbox } from '../lib/cash'
import { relationId } from '../lib/rooms'
import { roundMoney } from '../utils/payments'

const transferError = (path: string, message: string) =>
  new ValidationError({ collection: 'cash-transfers', errors: [{ path, message }] })

/**
 * Kasalar arası para aktarımı (ör. nakit kasadan bankaya yatırma). Kaynak kasadan `amount`
 * çıkar, hedef kasaya `toAmount` girer; dövizler aynıysa ikisi eşittir.
 */
export const CashTransfers: CollectionConfig = {
  slug: 'cash-transfers',
  labels: { singular: 'Virman', plural: 'Virmanlar' },
  access: adminOnlyAccess,
  admin: {
    group: 'Muhasebe',
    defaultColumns: ['from', 'to', 'amount', 'toAmount', 'transferredAt'],
  },
  defaultSort: '-transferredAt',
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'from',
          label: 'Kaynak kasa',
          type: 'relationship',
          relationTo: 'cashboxes',
          required: true,
          index: true,
          filterOptions: { active: { equals: true } },
        },
        {
          name: 'to',
          label: 'Hedef kasa',
          type: 'relationship',
          relationTo: 'cashboxes',
          required: true,
          index: true,
          filterOptions: { active: { equals: true } },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'amount',
          label: 'Çıkan tutar',
          type: 'number',
          required: true,
          min: 0.01,
          admin: { description: 'Kaynak kasanın para biriminde.' },
        },
        {
          name: 'toAmount',
          label: 'Giren tutar',
          type: 'number',
          admin: {
            description:
              'Hedef kasanın para biriminde. Dövizler aynıysa boş bırakın; çıkan tutar yazılır.',
          },
        },
      ],
    },
    {
      name: 'transferredAt',
      label: 'Tarih',
      type: 'date',
      required: true,
      index: true,
      defaultValue: () => new Date().toISOString(),
      admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'dd.MM.yyyy' } },
    },
    { name: 'note', label: 'Not', type: 'textarea' },
    {
      name: 'createdBy',
      label: 'Kaydeden',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        const fromValue = data.from ?? originalDoc?.from
        const toValue = data.to ?? originalDoc?.to
        if (String(relationId(fromValue)) === String(relationId(toValue))) {
          throw transferError('to', 'Kaynak ve hedef kasa aynı olamaz.')
        }
        const changed = (field: 'from' | 'to') =>
          operation === 'create' ||
          String(relationId(data[field])) !== String(relationId(originalDoc?.[field]))
        const from = await loadCashbox(req, fromValue, changed('from'))
        if ('error' in from) throw transferError('from', from.error!)
        const to = await loadCashbox(req, toValue, changed('to'))
        if ('error' in to) throw transferError('to', to.error!)

        const amount = roundMoney(Number(data.amount ?? originalDoc?.amount))
        if (!(amount > 0)) throw transferError('amount', 'Tutar sıfırdan büyük olmalıdır.')
        data.amount = amount

        if (from.cashbox.currency === to.cashbox.currency) {
          data.toAmount = amount
        } else {
          const toAmount = roundMoney(Number(data.toAmount ?? originalDoc?.toAmount))
          if (!(toAmount > 0)) {
            throw transferError(
              'toAmount',
              `Kasaların para birimi farklı (${from.cashbox.currency} → ${to.cashbox.currency}); ` +
                `hedef kasaya giren ${to.cashbox.currency} tutarını girin.`,
            )
          }
          data.toAmount = toAmount
        }
        if (operation === 'create' && req.user) data.createdBy = req.user.id
        return data
      },
    ],
  },
}
