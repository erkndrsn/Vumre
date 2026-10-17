import {
  APIError,
  ValidationError,
  type CollectionConfig,
  type RelationshipFieldSingleValidation,
} from 'payload'

import { relationship } from 'payload/shared'

import {
  adminOnly,
  adminOnlyField,
  adminOrManagedRegion,
  isAdmin,
  isRegionManager,
  managedRegionIds,
} from '../lib/access'
import { assignPilgrimsEndpoint } from '../lib/roomBoard'
import { exportPilgrimsEndpoint } from '../lib/pilgrimExport'
import { importPilgrimsEndpoint, importTemplateEndpoint } from '../lib/pilgrimImport'
import { groupCurrency, groupMembers, pilgrimCurrency } from '../lib/paymentGroups'
import { convertAdvancePayments, hasPaymentsInOtherCurrency } from '../lib/payments'
import { countOccupants, findFullRoomIds, relationId } from '../lib/rooms'
import { isValidTcNo } from '../lib/tcNo'
import { ageOn, isInfant, otherPricesForAge, priceForAge } from '../utils/childPricing'

export { isValidTcNo }

/** Tarih karşılaştırması için gün kısmı ("2020-05-10"). */
const dateKey = (value: unknown) =>
  value ? (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10) : null

const requiredRegion: RelationshipFieldSingleValidation = (value, args) =>
  value ? relationship(value, args) : 'Bölge seçin.'

export const Pilgrims: CollectionConfig = {
  slug: 'pilgrims',
  labels: { singular: 'Umreci', plural: 'Umreciler' },
  access: {
    // Bölge yöneticisi tüm umrecileri görür; yalnızca kendi bölgelerindekileri ekler ve kişi
    // bilgilerini düzenler. Seçilen bölgenin kendi bölgesi olduğu beforeChange'de denetlenir.
    read: ({ req }) => isAdmin(req.user) || isRegionManager(req.user),
    update: adminOrManagedRegion('region'),
    create: ({ req }) => isAdmin(req.user) || managedRegionIds(req.user).length > 0,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'fullName',
    group: 'Konaklama',
    defaultColumns: [
      'fullName',
      'region',
      'flightPoint',
      'tcNo',
      'phone',
      'room',
      'roomPrice',
      'roomCurrency',
    ],
    components: {
      beforeListTable: ['/components/PilgrimImport#PilgrimImport'],
    },
  },
  defaultSort: 'fullName',
  endpoints: [
    importTemplateEndpoint,
    importPilgrimsEndpoint,
    exportPilgrimsEndpoint,
    assignPilgrimsEndpoint,
  ],
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'firstName', label: 'Ad', type: 'text', required: true },
        { name: 'lastName', label: 'Soyad', type: 'text', required: true },
      ],
    },
    {
      name: 'fullName',
      label: 'Ad Soyad',
      type: 'text',
      index: true,
      admin: { hidden: true },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'tcNo',
          label: 'TC Kimlik No',
          type: 'text',
          unique: true,
          validate: (value: string | null | undefined) =>
            !value || isValidTcNo(value) || 'Geçerli bir TC Kimlik No girin.',
        },
        { name: 'passportNo', label: 'Pasaport No', type: 'text', unique: true },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'phone', label: 'Telefon', type: 'text' },
        {
          name: 'birthDate',
          label: 'Doğum tarihi',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayOnly', displayFormat: 'dd.MM.yyyy' } },
        },
        {
          name: 'gender',
          label: 'Cinsiyet',
          type: 'select',
          required: true,
          options: [
            { label: 'Erkek', value: 'male' },
            { label: 'Kadın', value: 'female' },
          ],
        },
      ],
    },
    {
      name: 'region',
      label: 'Bölge',
      type: 'relationship',
      relationTo: 'regions',
      index: true,
      filterOptions: { active: { equals: true } },
      // `required: true` kolonu NOT NULL yapar ve bölgesi olmayan eski kayıtlar şemayı bozar;
      // zorunluluk bu yüzden doğrulamada. Eski kayıtlar düzenlenirken bölge seçilmesi istenir.
      validate: requiredRegion,
    },
    {
      name: 'flightPoint',
      label: 'Uçuş başlangıç noktası',
      type: 'relationship',
      relationTo: 'flight-points',
      index: true,
      filterOptions: { active: { equals: true } },
      admin: {
        description:
          'Kişinin uçağa bineceği havalimanı. Boş bırakılırsa bölgenin uçuş noktası atanır.',
      },
    },
    { name: 'address', label: 'Adres', type: 'textarea' },
    { name: 'description', label: 'Açıklama', type: 'textarea' },
    {
      name: 'room',
      label: 'Oda',
      type: 'relationship',
      access: { create: adminOnlyField, update: adminOnlyField },
      relationTo: 'rooms',
      index: true,
      // Seçim listesinde yalnızca aktif ve boş yeri olan odalar çıkar. Bebekler kapasiteden
      // yer tutmadığı için dolu odalar da seçilebilir.
      filterOptions: async ({ id, req, data }) => {
        if (isInfant(data?.birthDate)) return { active: { equals: true } }
        const fullRoomIds = await findFullRoomIds(req, id || undefined)
        return {
          active: { equals: true },
          ...(fullRoomIds.length ? { id: { not_in: fullRoomIds } } : {}),
        }
      },
      admin: { position: 'sidebar' },
    },
    {
      name: 'paymentGroup',
      label: 'Ödeme grubu',
      type: 'relationship',
      access: { create: adminOnlyField, update: adminOnlyField },
      relationTo: 'payment-groups',
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'Aile gibi birlikte ödeme yapan kişiler; borç ve tahsilat grup toplamı üzerinden izlenir.',
      },
    },
    {
      name: 'roomOccupants',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: { Field: '/components/RoomOccupants#RoomOccupants' },
      },
    },
    {
      name: 'roomPrice',
      label: 'Oda ücreti',
      type: 'number',
      access: { create: adminOnlyField, update: adminOnlyField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Odaya atandığında oda tipinden alınır; doğum tarihine göre çocuk yaş aralığına giriyorsa çocuk ücreti uygulanır.',
      },
    },
    {
      name: 'roomCurrency',
      label: 'Para birimi',
      type: 'text',
      access: { create: adminOnlyField, update: adminOnlyField },
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'roomOtherPrices',
      label: 'Diğer para birimlerinde ücret',
      labels: { singular: 'Para birimi', plural: 'Para birimleri' },
      type: 'array',
      access: { create: adminOnlyField, update: adminOnlyField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'Oda tipinden alınır; ödeme bu para birimlerinde de yapılabilir.',
      },
      fields: [
        { name: 'currency', label: 'Para birimi', type: 'text', required: true },
        { name: 'price', label: 'Ücret', type: 'number', required: true },
      ],
    },
    {
      name: 'archived',
      label: 'Arşivde (programı iptal etti)',
      type: 'checkbox',
      access: { create: adminOnlyField, update: adminOnlyField },
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        description:
          'Arşive taşınan kişi odasından çıkarılır; oda yerleşiminde, panoda ve listelerde görünmez.',
      },
    },
    {
      name: 'archivedAt',
      label: 'Arşive taşınma tarihi',
      type: 'date',
      access: { create: adminOnlyField, update: adminOnlyField },
      admin: {
        position: 'sidebar',
        readOnly: true,
        condition: (data) => !!data?.archived,
        date: { pickerAppearance: 'dayAndTime', displayFormat: 'dd.MM.yyyy HH:mm' },
      },
    },
    {
      name: 'archiveReason',
      label: 'İptal nedeni',
      type: 'textarea',
      access: { create: adminOnlyField, update: adminOnlyField },
      admin: { position: 'sidebar', condition: (data) => !!data?.archived },
    },
    {
      name: 'payments',
      label: 'Tahsilatlar',
      type: 'join',
      collection: 'payments',
      on: 'pilgrim',
      defaultSort: '-paidAt',
    },
  ],
  hooks: {
    beforeChange: [
      // Bölge yöneticisi umreciyi yalnızca sorumlu olduğu bölgelere ekleyip bu bölgeler arasında
      // taşıyabilir.
      ({ data, req }) => {
        if (!req.user || isAdmin(req.user)) return data
        const regionId = relationId(data.region)
        if (!managedRegionIds(req.user).some((id) => String(id) === String(regionId))) {
          throw new ValidationError({
            collection: 'pilgrims',
            errors: [
              { path: 'region', message: 'Yalnızca sorumlu olduğunuz bölgeleri seçebilirsiniz.' },
            ],
          })
        }
        return data
      },
      // Uçuş noktası seçilmemişse bölgenin uçuş noktası atanır (ör. Aydın → İzmir). Bölge
      // değişince nokta boşsa ya da eski bölgenin noktasıysa yeni bölgeninkine geçer; elle
      // seçilmiş farklı nokta korunur. Bölge değişmeden boş bırakılan nokta doldurulmaz.
      async ({ data, originalDoc, req, operation }) => {
        const regionDefault = async (id: number | string | null) => {
          if (!id) return null
          const region = await req.payload
            .findByID({ collection: 'regions', id, depth: 0, req })
            .catch(() => null)
          return relationId(region?.defaultFlightPoint)
        }

        const previousRegionId = relationId(originalDoc?.region)
        const regionId = data.region !== undefined ? relationId(data.region) : previousRegionId
        const regionChanged = String(regionId) !== String(previousRegionId)
        if (!regionId || (operation !== 'create' && !regionChanged)) return data

        const current =
          data.flightPoint !== undefined
            ? relationId(data.flightPoint)
            : relationId(originalDoc?.flightPoint)
        if (current) {
          if (operation === 'create') return data
          const previousDefault = await regionDefault(previousRegionId)
          if (String(current) !== String(previousDefault)) return data
        }
        const defaultPoint = await regionDefault(regionId)
        if (defaultPoint) data.flightPoint = defaultPoint
        return data
      },
      async ({ data, originalDoc, req }) => {
        const firstName = (data.firstName ?? originalDoc?.firstName ?? '').trim()
        const lastName = (data.lastName ?? originalDoc?.lastName ?? '').trim()
        data.fullName = `${firstName} ${lastName}`.trim()

        // Programı iptal eden kişi arşive taşınınca odasından çıkar; arşivdeyken odaya atanamaz.
        const archived = (data.archived ?? originalDoc?.archived) === true
        const wasArchived = originalDoc?.archived === true
        if (archived && !wasArchived) {
          data.archivedAt = new Date().toISOString()
          data.room = null
        } else if (!archived && wasArchived) {
          data.archivedAt = null
          data.archiveReason = null
        } else if (archived && relationId(data.room ?? originalDoc?.room)) {
          throw new ValidationError({
            collection: 'pilgrims',
            errors: [
              { path: 'room', message: 'Arşivdeki umreci odaya atanamaz. Önce arşivden çıkarın.' },
            ],
          })
        }

        const roomGiven = data.room !== undefined
        const previousRoomId = relationId(originalDoc?.room)
        const roomId = roomGiven ? relationId(data.room) : previousRoomId

        if (!roomId) {
          if (roomGiven) {
            data.room = null
            data.roomPrice = null
            data.roomCurrency = null
            data.roomOtherPrices = []
          }
          return data
        }

        const roomChanged = String(roomId) !== String(previousRoomId)
        const birthDateChanged =
          data.birthDate !== undefined &&
          dateKey(data.birthDate) !== dateKey(originalDoc?.birthDate)
        // Aynı odada kalıyorsa atama anındaki ücret korunur; doğum tarihi düzeltilirse
        // yaşa göre ücret yeniden hesaplanır.
        if (!roomChanged && !birthDateChanged) return data

        const roomError = (message: string) =>
          new ValidationError({ collection: 'pilgrims', errors: [{ path: 'room', message }] })

        const room = await req.payload.findByID({
          collection: 'rooms',
          id: roomId,
          depth: 1,
          req,
        })
        const roomType = typeof room.roomType === 'object' ? room.roomType : null
        if (!roomType) throw roomError('Odanın oda tipi bulunamadı.')

        const birthDate = data.birthDate !== undefined ? data.birthDate : originalDoc?.birthDate
        const infant = isInfant(birthDate)
        // Bebekken odaya giren kişinin doğum tarihi düzeltilip bebeklikten çıkarsa yer tutmaya başlar.
        const nowTakesBed = birthDateChanged && !infant && isInfant(originalDoc?.birthDate)

        if (roomChanged && (!room.active || !roomType.active)) {
          throw roomError(`Oda ${room.roomNumber} pasif durumda, atama yapılamaz.`)
        }
        // Bebekler (0-1 yaş) kapasiteden yer tutmaz; odaya her zaman eklenebilir.
        if (!infant && (roomChanged || nowTakesBed)) {
          const capacity = room.capacity ?? roomType.capacity
          const occupied = await countOccupants(req, roomId, originalDoc?.id)
          if (occupied >= capacity) {
            throw roomError(
              roomChanged
                ? `Oda ${room.roomNumber} dolu (${occupied}/${capacity}). Bu odaya daha fazla kişi atanamaz.`
                : `Bu doğum tarihiyle kişi bebek sayılmıyor ve yatak tutuyor; Oda ${room.roomNumber} dolu (${occupied}/${capacity}).`,
            )
          }
        }

        // Odası belli olmadan alınmış ön ödemeler, ilk oda atamasında oda ücretinin para
        // birimine çevrilir: kişinin odası yoksa onunkiler, grubunda henüz kimse odada
        // değilse grubun tüm ön ödemeleri.
        if (roomChanged && originalDoc?.id !== undefined) {
          const groupId =
            data.paymentGroup !== undefined
              ? relationId(data.paymentGroup)
              : relationId(originalDoc.paymentGroup)
          let advancePayers: (number | string)[] = []
          if (groupId) {
            const others = await groupMembers(req, groupId, originalDoc.id)
            if (!others.some((m) => m.roomCurrency)) {
              advancePayers = [originalDoc.id, ...others.map((m) => m.id)]
            }
          } else if (!originalDoc.roomCurrency) {
            advancePayers = [originalDoc.id]
          }
          const conversionError = await convertAdvancePayments(req, advancePayers, {
            currency: roomType.currency,
            pricePerPerson: roomType.pricePerPerson,
            otherPrices: roomType.otherPrices,
          })
          if (conversionError) throw roomError(conversionError)
        }

        // Ödemeler borca odanın ana para biriminde yazılır; farklı para birimli odaya geçiş
        // bakiyeyi bozar.
        if (
          originalDoc?.id !== undefined &&
          (await hasPaymentsInOtherCurrency(req, originalDoc.id, roomType.currency))
        ) {
          throw roomError(
            `Bu umrecinin farklı para biriminde tahsilatı var; ${roomType.currency} ücretli Oda ${room.roomNumber} odasına taşınamaz.`,
          )
        }

        data.roomPrice = priceForAge(roomType, ageOn(birthDate))
        data.roomCurrency = roomType.currency
        data.roomOtherPrices = otherPricesForAge(roomType, ageOn(birthDate))
        return data
      },
      // Bir ödeme grubunda tek para birimi olur; aksi halde grubun toplamı anlamsızlaşır.
      async ({ data, originalDoc, req, context }) => {
        if (context.roomTypeSync) return data
        const groupGiven = data.paymentGroup !== undefined
        const groupId = groupGiven
          ? relationId(data.paymentGroup)
          : relationId(originalDoc?.paymentGroup)
        if (!groupId) return data
        const groupChanged = String(groupId) !== String(relationId(originalDoc?.paymentGroup))
        const currencyChanged =
          data.roomCurrency !== undefined && data.roomCurrency !== originalDoc?.roomCurrency
        if (!groupChanged && !currencyChanged) return data

        const own = await pilgrimCurrency(
          req,
          originalDoc?.id,
          data.roomCurrency !== undefined ? data.roomCurrency : originalDoc?.roomCurrency,
        )
        if (!own) return data
        const group = await groupCurrency(req, groupId, originalDoc?.id)
        if (group && group !== own) {
          throw new ValidationError({
            collection: 'pilgrims',
            errors: [
              {
                path: groupChanged ? 'paymentGroup' : 'room',
                message: `Ödeme grubundaki kişilerin ücretleri ${group}; ${own} ücretli kişi bu grupta olamaz.`,
              },
            ],
          })
        }
        return data
      },
    ],
    afterChange: [
      // Sorumlu kişi gruptan ayrılırsa grubun sorumlusu boşalır.
      async ({ doc, previousDoc, operation, req, context }) => {
        if (operation !== 'update' || context.deletingPaymentGroup) return doc
        const previousGroup = relationId(previousDoc?.paymentGroup)
        if (!previousGroup || String(previousGroup) === String(relationId(doc.paymentGroup))) {
          return doc
        }
        const group = await req.payload
          .findByID({ collection: 'payment-groups', id: previousGroup, depth: 0, req })
          .catch(() => null)
        if (group && String(relationId(group.responsible)) === String(doc.id)) {
          await req.payload.update({
            collection: 'payment-groups',
            id: group.id,
            data: { responsible: null },
            req,
          })
        }
        return doc
      },
    ],
    beforeDelete: [
      async ({ id, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'payments',
          where: { pilgrim: { equals: id } },
          req,
        })
        if (totalDocs > 0) {
          throw new APIError(
            `Bu umrecinin ${totalDocs} tahsilat kaydı var. Silmeden önce tahsilatları silin.`,
            400,
            null,
            true,
          )
        }
        // Kimlik ve dokümanlar dosyalarıyla birlikte silinir.
        await req.payload.delete({
          collection: 'pilgrim-documents',
          where: { pilgrim: { equals: id } },
          req,
        })
      },
    ],
  },
}
