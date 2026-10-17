import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { tr } from '@payloadcms/translations/languages/tr'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { RoomTypes } from './collections/RoomTypes'
import { Rooms } from './collections/Rooms'
import { Pilgrims } from './collections/Pilgrims'
import { PilgrimDocuments } from './collections/PilgrimDocuments'
import { Regions } from './collections/Regions'
import { FlightPoints } from './collections/FlightPoints'
import { Payments } from './collections/Payments'
import { PaymentGroups } from './collections/PaymentGroups'
import { Expenses } from './collections/Expenses'
import { Cashboxes } from './collections/Cashboxes'
import { CashTransfers } from './collections/CashTransfers'
import { backfillUserRoles } from './lib/access'
import { backfillCashboxes } from './lib/cash'
import { backfillPaymentDebt } from './lib/payments'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: { titleSuffix: ' · Vumre' },
    dateFormat: 'dd.MM.yyyy HH:mm',
    components: {
      beforeDashboard: ['/components/Dashboard#Dashboard'],
    },
  },
  // Panel yalnızca Türkçe: dil seçimi çıkmaz, tüm buton ve mesajlar Türkçe gelir.
  i18n: {
    supportedLanguages: { tr },
    fallbackLanguage: 'tr',
    // Payload'ın Türkçe paketinde İngilizce kalan metinler.
    translations: {
      tr: {
        authentication: { lockUntil: 'Kilit bitişi' },
        fields: {
          chooseBetweenCustomTextOrDocument:
            'Özel bir URL metni girmek ile başka bir dokümana bağlantı vermek arasında seçim yapın.',
          itemsAndMore: '{{items}} ve {{count}} tane daha',
          labelRelationship: '{{label}} ilişkisi',
          relationTo: 'İlişkili koleksiyon',
        },
        general: { of: '/', or: 'Veya', order: 'Sıra' },
        version: { confirmRevertToSaved: 'Kaydedilmiş hâline dönmeyi onayla' },
      },
    },
  },
  collections: [
    Users,
    Media,
    FlightPoints,
    Regions,
    RoomTypes,
    Rooms,
    Pilgrims,
    PilgrimDocuments,
    PaymentGroups,
    Cashboxes,
    Payments,
    Expenses,
    CashTransfers,
  ],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || '',
    },
    // Transaction'lar açık: toplu atama gibi çok kayıtlı işlemler ya tamamen yazılır ya hiç.
    // WAL'da okumalar yazmayı beklemez; busyTimeout, çakışan yazmaların hata vermek yerine
    // sıra beklemesini sağlar (aksi halde transaction'larla "database is locked" alınır).
    transactionOptions: {},
    wal: true,
    busyTimeout: 5000,
  }),
  sharp,
  plugins: [],
  // Rol alanı öncesi kullanıcılar admin olur; çoklu para birimi öncesi kaydedilmiş
  // tahsilatların borçtan düşülen tutarı hesaplanır.
  onInit: async (payload) => {
    await backfillUserRoles(payload)
    await backfillPaymentDebt(payload)
    await backfillCashboxes(payload)
  },
})
