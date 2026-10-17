import { ValidationError, type CollectionConfig } from 'payload'

import { adminOnlyAccess } from '../lib/access'
import { loadCashbox } from '../lib/cash'
import { CURRENCY_OPTIONS, relationId } from '../lib/rooms'
import { EXPENSE_CATEGORY_OPTIONS } from '../utils/cash'
import { PAYMENT_METHOD_OPTIONS, roundMoney } from '../utils/payments'

const expenseError = (path: string, message: string) =>
  new ValidationError({ collection: 'expenses', errors: [{ path, message }] })

/**
 * Kasadan yapılan ödemeler (otel, ulaşım, vize…). Para birimi ve ödeme şekli kasadan gelir.
 * Kasa bakiyesini aşan ödeme engellenmez (kasa eksiye düşebilir); arayüz uyarır.
 */
export const Expenses: CollectionConfig = {
  slug: 'expenses',
  labels: { singular: 'Gider', plural: 'Giderler' },
  access: adminOnlyAccess,
  admin: {
    useAsTitle: 'description',
    group: 'Muhasebe',
    defaultColumns: ['description', 'category', 'payee', 'amount', 'currency', 'cashbox', 'paidAt'],
  },
  defaultSort: '-paidAt',
  fields: [
    { name: 'description', label: 'Açıklama', type: 'text', required: true },
    {
      type: 'row',
      fields: [
        {
          name: 'category',
          label: 'Kategori',
          type: 'select',
          required: true,
          defaultValue: 'other',
          options: EXPENSE_CATEGORY_OPTIONS,
          index: true,
        },
        { name: 'payee', label: 'Ödenen kişi / firma', type: 'text' },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          // Şemada zorunlu değil (eski kayıtlar açılışta kasaya bağlanır); hook zorunlu tutar.
          name: 'cashbox',
          label: 'Kasa',
          type: 'relationship',
          relationTo: 'cashboxes',
          index: true,
          filterOptions: { active: { equals: true } },
          admin: { description: 'Paranın çıktığı kasa.' },
        },
        { name: 'amount', label: 'Tutar', type: 'number', required: true, min: 0.01 },
        {
          name: 'currency',
          label: 'Para birimi',
          type: 'select',
          required: true,
          options: CURRENCY_OPTIONS,
          index: true,
          // Zorunlu alan olduğundan panelde seçilebilir; kaydederken kasanınki yazılır.
          admin: { description: 'Kaydederken kasanın para birimi yazılır.' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'paidAt',
          label: 'Ödeme tarihi',
          type: 'date',
          required: true,
          index: true,
          defaultValue: () => new Date().toISOString(),
          admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'dd.MM.yyyy' } },
        },
        {
          name: 'method',
          label: 'Ödeme şekli',
          type: 'select',
          required: true,
          defaultValue: 'cash',
          options: PAYMENT_METHOD_OPTIONS,
          admin: { readOnly: true, description: 'Kasanın türünden gelir.' },
        },
        { name: 'receiptNo', label: 'Fatura / dekont no', type: 'text' },
      ],
    },
    { name: 'note', label: 'Not', type: 'textarea' },
    {
      name: 'paidBy',
      label: 'Kaydeden',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
  hooks: {
    // Para birimi zorunlu alan olduğu için kasadan doğrulamadan önce doldurulur.
    beforeValidate: [
      async ({ data, originalDoc, operation, req }) => {
        if (!data) return data
        const cashboxValue = data.cashbox ?? originalDoc?.cashbox
        const loaded = await loadCashbox(
          req,
          cashboxValue,
          operation === 'create' ||
            String(relationId(cashboxValue)) !== String(relationId(originalDoc?.cashbox)),
        )
        if ('error' in loaded) throw expenseError('cashbox', loaded.error!)
        data.cashbox = loaded.cashbox.id
        data.currency = loaded.cashbox.currency
        data.method = loaded.cashbox.kind ?? 'cash'
        return data
      },
    ],
    beforeChange: [
      ({ data, operation, req }) => {
        if (data.amount != null) data.amount = roundMoney(Number(data.amount))
        if (operation === 'create' && req.user) data.paidBy = req.user.id
        return data
      },
    ],
  },
}
