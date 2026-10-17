import { ValidationError, type CollectionConfig } from 'payload'

import { adminOnlyAccess } from '../lib/access'
import { createGroupEndpoint, groupMembersEndpoint } from '../lib/paymentGroups'
import { relationId } from '../lib/rooms'

/**
 * Ödemesi birlikte takip edilen kişiler (ör. bir aile). Odadan bağımsızdır: grubun borcu
 * üyelerin oda ücretleri toplamı, ödemeler de üyelerin ödemeleri toplamıdır.
 */
export const PaymentGroups: CollectionConfig = {
  slug: 'payment-groups',
  labels: { singular: 'Ödeme Grubu', plural: 'Ödeme Grupları' },
  access: adminOnlyAccess,
  admin: {
    useAsTitle: 'name',
    group: 'Muhasebe',
    defaultColumns: ['name', 'responsible', 'note'],
  },
  defaultSort: 'name',
  endpoints: [createGroupEndpoint, groupMembersEndpoint],
  fields: [
    { name: 'name', label: 'Grup adı', type: 'text', required: true, unique: true },
    {
      name: 'responsible',
      label: 'Sorumlu kişi',
      type: 'relationship',
      relationTo: 'pilgrims',
      // Yalnızca bu grubun üyeleri; borç hatırlatması bu kişinin telefonuna gider.
      filterOptions: ({ id }) => (id ? { paymentGroup: { equals: id } } : false),
      admin: { description: 'Borç hatırlatmaları bu kişiye gönderilir.' },
    },
    { name: 'note', label: 'Not', type: 'textarea' },
    {
      name: 'members',
      label: 'Üyeler',
      type: 'join',
      collection: 'pilgrims',
      on: 'paymentGroup',
      defaultSort: 'fullName',
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        const responsibleId = relationId(data.responsible)
        if (responsibleId === null) return data
        const pilgrim = await req.payload
          .findByID({ collection: 'pilgrims', id: responsibleId, depth: 0, req })
          .catch(() => null)
        const groupId = originalDoc?.id
        if (
          !pilgrim ||
          groupId === undefined ||
          String(relationId(pilgrim.paymentGroup)) !== String(groupId)
        ) {
          throw new ValidationError({
            collection: 'payment-groups',
            errors: [
              { path: 'responsible', message: 'Sorumlu kişi grubun üyelerinden biri olmalıdır.' },
            ],
          })
        }
        return data
      },
    ],
    beforeDelete: [
      // Üyeler tek kişilik takibe döner; ödemeleri kendilerinde kalır.
      async ({ id, req }) => {
        await req.payload.update({
          collection: 'pilgrims',
          where: { paymentGroup: { equals: id } },
          data: { paymentGroup: null },
          context: { deletingPaymentGroup: true },
          req,
        })
      },
    ],
  },
}
