import { ValidationError, type CollectionConfig } from 'payload'

import { adminOnlyAccess } from '../lib/access'
import { loadCashbox } from '../lib/cash'
import { groupDebt, groupMembers } from '../lib/paymentGroups'
import { accountsEndpoint, advanceCurrency, balancesEndpoint, paidTotal } from '../lib/payments'
import { CURRENCY_OPTIONS, relationId } from '../lib/rooms'
import {
  PAYMENT_METHOD_OPTIONS,
  convertFromDebt,
  payableCurrencies,
  roundMoney,
  type CurrencyPrice,
} from '../utils/payments'

const paymentError = (path: string, message: string) =>
  new ValidationError({ collection: 'payments', errors: [{ path, message }] })

const money = (amount: number, currency: string) =>
  `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(amount)} ${currency}`

export const Payments: CollectionConfig = {
  slug: 'payments',
  labels: { singular: 'Tahsilat', plural: 'Tahsilatlar' },
  access: adminOnlyAccess,
  admin: {
    group: 'Muhasebe',
    defaultColumns: ['pilgrim', 'amount', 'currency', 'cashbox', 'debtAmount', 'paidAt'],
  },
  defaultSort: '-paidAt',
  endpoints: [balancesEndpoint, accountsEndpoint],
  fields: [
    {
      name: 'pilgrim',
      label: 'Umreci',
      type: 'relationship',
      relationTo: 'pilgrims',
      required: true,
      index: true,
      admin: {
        description:
          'Odası belli değilse tahsilat ön ödeme olarak alınır; odaya atanınca ücretten düşülür.',
      },
    },
    {
      type: 'row',
      fields: [
        { name: 'amount', label: 'Tutar', type: 'number', required: true, min: 0.01 },
        {
          name: 'currency',
          label: 'Para birimi',
          type: 'select',
          options: CURRENCY_OPTIONS,
          index: true,
          admin: {
            description:
              'Boş bırakılırsa kasanın para birimi. Oda tipinde fiyatı girilmiş diğer ' +
              'para birimleriyle de ödeme alınabilir.',
          },
        },
        {
          // Şemada zorunlu değil (eski kayıtlar açılışta kasaya bağlanır); hook zorunlu tutar.
          name: 'cashbox',
          label: 'Kasa',
          type: 'relationship',
          relationTo: 'cashboxes',
          index: true,
          filterOptions: { active: { equals: true } },
          admin: { description: 'Paranın girdiği kasa; para birimi tahsilatla aynı olmalı.' },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'debtAmount',
          label: 'Borçtan düşülen',
          type: 'number',
          admin: {
            readOnly: true,
            description: 'Farklı para birimindeki ödeme, oda ücretlerinin oranıyla çevrilir.',
          },
        },
        {
          name: 'debtCurrency',
          label: 'Borç para birimi',
          type: 'text',
          index: true,
          admin: { readOnly: true },
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
        { name: 'receiptNo', label: 'Makbuz / dekont no', type: 'text' },
      ],
    },
    { name: 'note', label: 'Not', type: 'textarea' },
    {
      name: 'receivedBy',
      label: 'Tahsil eden',
      type: 'relationship',
      relationTo: 'users',
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, operation, req }) => {
        const pilgrimId = relationId(data.pilgrim ?? originalDoc?.pilgrim)
        if (!pilgrimId) throw paymentError('pilgrim', 'Umreci seçin.')

        const pilgrim = await req.payload
          .findByID({ collection: 'pilgrims', id: pilgrimId, depth: 1, req })
          .catch(() => null)
        if (!pilgrim) throw paymentError('pilgrim', 'Umreci bulunamadı.')

        const amount = roundMoney(Number(data.amount ?? originalDoc?.amount))
        if (!(amount > 0)) throw paymentError('amount', 'Tutar sıfırdan büyük olmalıdır.')

        // Borç, kişi bir ödeme grubundaysa grubun toplamıdır. Düzenlenen ödemenin eski
        // tutarı sayılmaz. Odası belli değilse (grupta kimse odada değilse) borç yoktur;
        // ödeme ön ödeme olarak alınır ve odaya atanınca ücretten düşülür.
        const group = typeof pilgrim.paymentGroup === 'object' ? pilgrim.paymentGroup : null
        let debt: {
          price: number
          otherPrices: CurrencyPrice[]
          paid: number
          currency: string | null
          owner: string
        } | null = null
        let payerIds: (number | string)[] = [pilgrimId]
        if (group) {
          const groupDebtInfo = await groupDebt(req, group.id, originalDoc?.id)
          if (groupDebtInfo.currency && groupDebtInfo.price > 0) {
            debt = { ...groupDebtInfo, owner: group.name }
          } else {
            payerIds = (await groupMembers(req, group.id)).map((m) => m.id)
          }
        } else if (pilgrim.roomPrice != null && pilgrim.roomCurrency) {
          debt = {
            price: pilgrim.roomPrice,
            otherPrices: (pilgrim.roomOtherPrices ?? []).map(({ currency, price }) => ({
              currency,
              price,
            })),
            paid: await paidTotal(req, pilgrimId, originalDoc?.id),
            currency: pilgrim.roomCurrency,
            owner: pilgrim.fullName ?? '',
          }
        }

        const cashboxValue = data.cashbox ?? originalDoc?.cashbox
        const loaded = await loadCashbox(
          req,
          cashboxValue,
          operation === 'create' ||
            String(relationId(cashboxValue)) !== String(relationId(originalDoc?.cashbox)),
        )
        if ('error' in loaded) throw paymentError('cashbox', loaded.error!)
        const { cashbox } = loaded

        const currency = (data.currency ?? originalDoc?.currency) || cashbox.currency
        if (currency !== cashbox.currency) {
          throw paymentError(
            'cashbox',
            `${cashbox.name} ${cashbox.currency} kasası; ${currency} tahsilat bu kasaya girilemez.`,
          )
        }

        data.amount = amount
        data.currency = currency
        data.cashbox = cashbox.id
        data.method = cashbox.kind ?? 'cash'

        if (!debt) {
          const owner = group ? `${group.name} grubu` : (pilgrim.fullName ?? '')
          const previous = await advanceCurrency(req, payerIds, originalDoc?.id)
          if (previous && previous !== currency) {
            throw paymentError(
              'currency',
              `${owner} için önceki ön ödemeler ${previous}; odası belli olmadan farklı para ` +
                `biriminde ödeme alınamaz.`,
            )
          }
          data.debtCurrency = currency
          data.debtAmount = amount
          if (operation === 'create' && req.user) data.receivedBy = req.user.id
          return data
        }

        const payable = payableCurrencies(debt)
        const target = payable.find((c) => c.currency === currency)
        if (!target) {
          throw paymentError(
            'currency',
            `${debt.owner} için ${currency} ile ödeme alınamaz; oda tipinde ${currency} fiyatı yok. ` +
              `Geçerli para birimleri: ${payable.map((c) => c.currency).join(', ')}.`,
          )
        }

        const remaining = roundMoney(debt.price - debt.paid)
        // Kalan borcun ödeme para birimindeki karşılığı; tamamı ödenirse borç kuruşu kuruşuna kapanır.
        const remainingInCurrency = convertFromDebt(remaining, debt, currency) ?? 0
        if (remaining <= 0 || amount > remainingInCurrency) {
          throw paymentError(
            'amount',
            remaining > 0
              ? `Kalan borç ${money(remainingInCurrency, currency)}` +
                  (currency !== debt.currency ? ` (${money(remaining, debt.currency!)})` : '') +
                  '; en fazla bu kadar tahsil edilebilir.'
              : `${debt.owner} için kalan borç yok.`,
          )
        }

        data.debtCurrency = debt.currency
        data.debtAmount =
          amount === remainingInCurrency
            ? remaining
            : Math.min(remaining, roundMoney((amount * debt.price) / target.price))
        if (!(data.debtAmount > 0)) {
          throw paymentError('amount', 'Tutar, borç para biriminde kuruştan az; geçerli değil.')
        }
        if (operation === 'create' && req.user) data.receivedBy = req.user.id
        return data
      },
    ],
  },
}
