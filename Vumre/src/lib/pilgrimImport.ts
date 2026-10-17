import ExcelJS from 'exceljs'
import {
  addDataAndFileToRequest,
  APIError,
  ValidationError,
  type Endpoint,
  type PayloadRequest,
  type RequiredDataFromCollectionSlug,
} from 'payload'

import { isInfant } from '../utils/childPricing'
import { groupCurrency } from './paymentGroups'
import { relationId } from './rooms'
import { requireAdmin } from './access'
import { isValidTcNo } from './tcNo'

export const MAX_IMPORT_ROWS = 2000
const MAX_FILE_SIZE = 5 * 1024 * 1024
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SHEET_NAME = 'Umreciler'
const REGIONS_SHEET_NAME = 'Bölgeler'
const FLIGHT_POINTS_SHEET_NAME = 'Uçuş Noktaları'

type ColumnKey =
  | 'firstName'
  | 'lastName'
  | 'gender'
  | 'region'
  | 'tcNo'
  | 'passportNo'
  | 'phone'
  | 'flightPoint'
  | 'birthDate'
  | 'room'
  | 'paymentGroup'
  | 'address'
  | 'description'

interface Column {
  key: ColumnKey
  header: string
  required?: boolean
  /** Kullanıcının kendi dosyasında karşılaşılabilecek diğer başlık yazımları. */
  aliases?: string[]
  width: number
  /** Excel hücre biçimi; '@' metin demektir (TC No'nun sayıya dönüşmesini önler). */
  numFmt?: string
}

export const IMPORT_COLUMNS: Column[] = [
  { key: 'firstName', header: 'Ad', required: true, aliases: ['Adı', 'İsim'], width: 16 },
  { key: 'lastName', header: 'Soyad', required: true, aliases: ['Soyadı'], width: 16 },
  { key: 'gender', header: 'Cinsiyet', required: true, width: 11 },
  { key: 'region', header: 'Bölge', required: true, width: 18 },
  {
    key: 'tcNo',
    header: 'TC Kimlik No',
    aliases: ['TC', 'TC No', 'TCKN', 'Kimlik No'],
    width: 15,
    numFmt: '@',
  },
  { key: 'passportNo', header: 'Pasaport No', aliases: ['Pasaport'], width: 14, numFmt: '@' },
  {
    key: 'phone',
    header: 'Telefon',
    aliases: ['Tel', 'GSM', 'Cep Telefonu'],
    width: 15,
    numFmt: '@',
  },
  { key: 'birthDate', header: 'Doğum Tarihi', width: 13, numFmt: 'dd.mm.yyyy' },
  {
    key: 'flightPoint',
    header: 'Uçuş Noktası',
    aliases: ['Uçuş', 'Kalkış Noktası', 'Havalimanı', 'Uçuş Başlangıç Noktası'],
    width: 24,
  },
  { key: 'room', header: 'Oda No', aliases: ['Oda', 'Oda Numarası'], width: 10, numFmt: '@' },
  {
    key: 'paymentGroup',
    header: 'Ödeme Grubu',
    aliases: ['Aile', 'Grup', 'Ödeme Grubu Adı'],
    width: 18,
  },
  { key: 'address', header: 'Adres', width: 30 },
  { key: 'description', header: 'Açıklama', aliases: ['Not'], width: 30 },
]

/** Başlık ve isim karşılaştırması için: Türkçe karakterler sadeleşir, boşluk ve noktalama atılır. */
export function normalizeKey(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]/g, '')
}

const HEADER_LOOKUP = new Map<string, ColumnKey>(
  IMPORT_COLUMNS.flatMap((c) =>
    [c.header, ...(c.aliases ?? [])].map((h) => [normalizeKey(h), c.key]),
  ),
)

const GENDER_LOOKUP: Record<string, 'male' | 'female'> = {
  erkek: 'male',
  e: 'male',
  bay: 'male',
  male: 'male',
  m: 'male',
  kadin: 'female',
  k: 'female',
  bayan: 'female',
  female: 'female',
  f: 'female',
}

export interface PilgrimInput {
  firstName: string
  lastName: string
  gender?: 'male' | 'female'
  regionName: string
  /** Uçuş noktasının adı, şehri ya da havalimanı kodu; boşsa bölgenin noktası atanır. */
  flightPointName?: string
  roomNumber?: string
  /** Ödeme grubu adı; sistemde yoksa içe aktarmada oluşturulur. */
  groupName?: string
  tcNo?: string
  passportNo?: string
  phone?: string
  /** ISO tarih (gün ortası UTC, saat dilimi kaymasın diye). */
  birthDate?: string
  address?: string
  description?: string
}

export interface ImportRow {
  /** Excel'deki satır numarası (kullanıcıya hata gösterirken). */
  row: number
  input: PilgrimInput
  errors: string[]
  data?: RequiredDataFromCollectionSlug<'pilgrims'>
  /** Sistemde olmayan, içe aktarmada oluşturulacak ödeme grubunun adı. */
  newGroupName?: string
  created?: boolean
}

export interface ImportRowResult {
  row: number
  fullName: string
  regionName: string
  roomNumber?: string
  status: 'ok' | 'error'
  errors: string[]
}

export interface ImportResult {
  dryRun: boolean
  total: number
  /** Önizlemede eklenebilecek, içe aktarmada eklenen kayıt sayısı. */
  ok: number
  failed: number
  rows: ImportRowResult[]
  /** Önizlemede oluşturulacak, içe aktarmada oluşturulan ödeme grupları. */
  newGroups: string[]
}

const fileError = (message: string) => new APIError(message, 400, null, true)

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatDay(value)
  if (typeof value === 'object') {
    if ('richText' in value)
      return value.richText
        .map((r) => r.text)
        .join('')
        .trim()
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('text' in value) return cellText(value.text as ExcelJS.CellValue)
    return ''
  }
  return String(value).trim()
}

function formatDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`
}

function isoDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  if (year < 1900 || date.getTime() > Date.now()) return null
  return date.toISOString()
}

/** Excel tarih hücresi, seri numarası veya "gg.aa.yyyy" / "yyyy-aa-gg" metnini kabul eder. */
export function parseBirthDate(value: ExcelJS.CellValue): string | null | undefined {
  if (value && typeof value === 'object' && !(value instanceof Date) && 'result' in value) {
    return parseBirthDate(value.result as ExcelJS.CellValue)
  }
  if (value instanceof Date) {
    return isoDay(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }
  if (typeof value === 'number') {
    // Excel seri numarası: 1899-12-30'dan bu yana geçen gün.
    const date = new Date(Math.round((value - 25569) * 86_400_000))
    return isoDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }
  const text = cellText(value)
  if (!text) return undefined
  let match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (match) return isoDay(Number(match[3]), Number(match[2]), Number(match[1]))
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) return isoDay(Number(match[1]), Number(match[2]), Number(match[3]))
  return null
}

/** Excel dosyasını okur, satırları biçim yönünden doğrular. Veritabanına bakmaz. */
export async function readWorkbook(data: Buffer | ArrayBuffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(data as ArrayBuffer)
  } catch {
    throw fileError('Dosya okunamadı. Lütfen .xlsx biçiminde bir Excel dosyası yükleyin.')
  }

  const sheet =
    workbook.worksheets.find((ws) => normalizeKey(ws.name) === normalizeKey(SHEET_NAME)) ??
    workbook.worksheets[0]
  if (!sheet) throw fileError('Excel dosyasında sayfa bulunamadı.')

  const columns = new Map<number, ColumnKey>()
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const key = HEADER_LOOKUP.get(normalizeKey(cellText(cell.value)))
    if (key && ![...columns.values()].includes(key)) columns.set(colNumber, key)
  })
  const missing = IMPORT_COLUMNS.filter(
    (c) => c.required && ![...columns.values()].includes(c.key),
  ).map((c) => c.header)
  if (missing.length) {
    throw fileError(
      `İlk satırda zorunlu sütun başlıkları bulunamadı: ${missing.join(', ')}. Şablonu indirip kullanabilirsiniz.`,
    )
  }

  const rows: ImportRow[] = []
  sheet.eachRow((excelRow, rowNumber) => {
    if (rowNumber === 1) return
    const raw: Partial<Record<ColumnKey, ExcelJS.CellValue>> = {}
    for (const [colNumber, key] of columns) raw[key] = excelRow.getCell(colNumber).value
    const text = (key: ColumnKey) => cellText(raw[key] ?? null)
    if (IMPORT_COLUMNS.every((c) => !text(c.key))) return

    const errors: string[] = []
    const input: PilgrimInput = {
      firstName: text('firstName'),
      lastName: text('lastName'),
      regionName: text('region'),
    }
    if (!input.firstName) errors.push('Ad boş.')
    if (!input.lastName) errors.push('Soyad boş.')
    if (!input.regionName) errors.push('Bölge boş.')

    const gender = text('gender')
    input.gender = GENDER_LOOKUP[normalizeKey(gender)]
    if (!gender) errors.push('Cinsiyet boş.')
    else if (!input.gender)
      errors.push(`Cinsiyet "${gender}" anlaşılamadı (Erkek veya Kadın yazın).`)

    const tcNo = text('tcNo').replace(/\s/g, '')
    if (tcNo) {
      input.tcNo = tcNo
      if (!isValidTcNo(tcNo)) errors.push(`TC Kimlik No "${tcNo}" geçersiz.`)
    }
    const passportNo = text('passportNo').replace(/\s/g, '').toLocaleUpperCase('tr')
    if (passportNo) input.passportNo = passportNo

    const birthDate = parseBirthDate(raw.birthDate ?? null)
    if (birthDate) input.birthDate = birthDate
    else if (birthDate === null) {
      errors.push(`Doğum tarihi "${text('birthDate')}" geçersiz (gg.aa.yyyy biçiminde yazın).`)
    }

    for (const key of ['phone', 'address', 'description'] as const) {
      if (text(key)) input[key] = text(key)
    }
    if (text('room')) input.roomNumber = text('room')
    if (text('flightPoint')) input.flightPointName = text('flightPoint')
    if (text('paymentGroup')) input.groupName = text('paymentGroup')

    rows.push({ row: rowNumber, input, errors })
  })

  if (!rows.length) throw fileError('Dosyada aktarılacak satır bulunamadı.')
  if (rows.length > MAX_IMPORT_ROWS) {
    throw fileError(
      `Tek seferde en fazla ${MAX_IMPORT_ROWS} satır aktarılabilir (dosyada ${rows.length} var).`,
    )
  }

  markDuplicates(rows, 'tcNo', 'TC Kimlik No')
  markDuplicates(rows, 'passportNo', 'Pasaport No')
  return rows
}

function markDuplicates(rows: ImportRow[], key: 'tcNo' | 'passportNo', label: string) {
  const firstSeen = new Map<string, number>()
  for (const r of rows) {
    const value = r.input[key]
    if (!value) continue
    const first = firstSeen.get(value)
    if (first === undefined) firstSeen.set(value, r.row)
    else r.errors.push(`${label} ${value} dosyada ${first}. satırda da var.`)
  }
}

/**
 * Satırları veritabanına göre doğrular (bölge, oda, mükerrer kayıt, oda kapasitesi)
 * ve hatasız satırlar için oluşturulacak veriyi hazırlar.
 */
export async function resolveRows(req: PayloadRequest, rows: ImportRow[]): Promise<ImportRow[]> {
  const tcNos = rows.map((r) => r.input.tcNo).filter((v): v is string => !!v)
  const passportNos = rows.map((r) => r.input.passportNo).filter((v): v is string => !!v)

  const [regions, rooms, occupied, existing, groups, flightPoints] = await Promise.all([
    req.payload.find({
      collection: 'regions',
      select: { name: true, active: true },
      pagination: false,
      depth: 0,
      req,
    }),
    rows.some((r) => r.input.roomNumber)
      ? req.payload.find({
          collection: 'rooms',
          pagination: false,
          depth: 1,
          context: { skipOccupancy: true },
          req,
        })
      : { docs: [] },
    req.payload.find({
      collection: 'pilgrims',
      where: { room: { exists: true } },
      select: { room: true, birthDate: true },
      pagination: false,
      depth: 0,
      req,
    }),
    tcNos.length || passportNos.length
      ? req.payload.find({
          collection: 'pilgrims',
          where: {
            or: [
              ...(tcNos.length ? [{ tcNo: { in: tcNos } }] : []),
              ...(passportNos.length ? [{ passportNo: { in: passportNos } }] : []),
            ],
          },
          select: { tcNo: true, passportNo: true, fullName: true },
          pagination: false,
          depth: 0,
          req,
        })
      : { docs: [] },
    rows.some((r) => r.input.groupName)
      ? req.payload.find({
          collection: 'payment-groups',
          select: { name: true },
          pagination: false,
          depth: 0,
          req,
        })
      : { docs: [] },
    rows.some((r) => r.input.flightPointName)
      ? req.payload.find({
          collection: 'flight-points',
          select: { name: true, city: true, airportCode: true, active: true },
          pagination: false,
          depth: 0,
          req,
        })
      : { docs: [] },
  ])

  const regionByName = new Map(regions.docs.map((r) => [normalizeKey(r.name), r]))
  const roomByNumber = new Map(rooms.docs.map((r) => [normalizeKey(r.roomNumber), r]))
  const occupancy = new Map<string, number>()
  for (const p of occupied.docs) {
    // Bebekler kapasiteden yer tutmaz.
    if (isInfant(p.birthDate)) continue
    const id = relationId(p.room)
    if (id !== null) occupancy.set(String(id), (occupancy.get(String(id)) ?? 0) + 1)
  }
  const existingTc = new Map(existing.docs.filter((p) => p.tcNo).map((p) => [p.tcNo!, p.fullName]))
  const existingPassport = new Map(
    existing.docs.filter((p) => p.passportNo).map((p) => [p.passportNo!, p.fullName]),
  )
  const groupByName = new Map(groups.docs.map((g) => [normalizeKey(g.name), g]))
  // Uçuş noktası adıyla, havalimanı koduyla ya da şehriyle yazılabilir; ad önceliklidir.
  // Aynı şehirde birden çok nokta varsa (İstanbul: IST, SAW) şehir adı tek başına eşleşmez.
  const cityCounts = new Map<string, number>()
  for (const p of flightPoints.docs) {
    const city = normalizeKey(p.city)
    cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1)
  }
  const flightPointByKey = new Map<string, (typeof flightPoints.docs)[number]>()
  for (const p of flightPoints.docs) {
    if (cityCounts.get(normalizeKey(p.city)) === 1) flightPointByKey.set(normalizeKey(p.city), p)
  }
  for (const p of flightPoints.docs) {
    if (p.airportCode) flightPointByKey.set(normalizeKey(p.airportCode), p)
  }
  for (const p of flightPoints.docs) flightPointByKey.set(normalizeKey(p.name), p)
  // Grubun para birimi: mevcut gruplarda sistemdeki üyelerden, yeni gruplarda dosyadaki ilk odadan.
  const groupCurrencies = new Map<string, string | null>()
  // Yeni grup adı dosyada farklı yazılsa da ilk yazılışıyla oluşturulur.
  const newGroupNames = new Map<string, string>()

  for (const r of rows) {
    const { input, errors } = r

    const region = input.regionName ? regionByName.get(normalizeKey(input.regionName)) : undefined
    if (input.regionName && !region) errors.push(`"${input.regionName}" adında bölge yok.`)
    else if (region && !region.active) errors.push(`${region.name} bölgesi pasif.`)

    const flightPoint = input.flightPointName
      ? flightPointByKey.get(normalizeKey(input.flightPointName))
      : undefined
    if (input.flightPointName && !flightPoint) {
      errors.push(`"${input.flightPointName}" adında uçuş noktası yok.`)
    } else if (flightPoint && !flightPoint.active) {
      errors.push(`${flightPoint.name} uçuş noktası pasif.`)
    }

    if (input.tcNo && existingTc.has(input.tcNo)) {
      errors.push(`TC Kimlik No ${input.tcNo} zaten kayıtlı (${existingTc.get(input.tcNo)}).`)
    }
    if (input.passportNo && existingPassport.has(input.passportNo)) {
      errors.push(
        `Pasaport No ${input.passportNo} zaten kayıtlı (${existingPassport.get(input.passportNo)}).`,
      )
    }

    const room = input.roomNumber ? roomByNumber.get(normalizeKey(input.roomNumber)) : undefined
    if (input.roomNumber && !room) errors.push(`${input.roomNumber} numaralı oda yok.`)
    if (room) {
      const roomType = typeof room.roomType === 'object' ? room.roomType : null
      const capacity = room.capacity ?? roomType?.capacity ?? 0
      const count = occupancy.get(String(room.id)) ?? 0
      if (!room.active || (roomType && !roomType.active)) {
        errors.push(`Oda ${room.roomNumber} pasif durumda.`)
      } else if (isInfant(input.birthDate)) {
        // Bebek: dolu odaya da eklenebilir, doluluğu artırmaz.
      } else if (count >= capacity) {
        errors.push(`Oda ${room.roomNumber} dolu (${count}/${capacity}).`)
      } else if (!errors.length) {
        // Dosyadaki önceki satırlar da odayı dolduruyor.
        occupancy.set(String(room.id), count + 1)
      }
    }

    const groupKey = input.groupName ? normalizeKey(input.groupName) : ''
    const group = groupKey ? groupByName.get(groupKey) : undefined
    const roomCurrency =
      room && typeof room.roomType === 'object' ? (room.roomType?.currency ?? null) : null
    if (groupKey && roomCurrency) {
      if (group && !groupCurrencies.has(groupKey)) {
        groupCurrencies.set(groupKey, await groupCurrency(req, group.id))
      }
      const expected = groupCurrencies.get(groupKey)
      if (expected && expected !== roomCurrency) {
        errors.push(
          `${input.groupName} grubundaki ücretler ${expected}; Oda ${room!.roomNumber} ${roomCurrency} ücretli.`,
        )
      } else if (!expected && !errors.length) {
        groupCurrencies.set(groupKey, roomCurrency)
      }
    }

    if (errors.length || !region || !input.gender) continue
    if (groupKey && !group) {
      if (!newGroupNames.has(groupKey)) newGroupNames.set(groupKey, input.groupName!)
      r.newGroupName = newGroupNames.get(groupKey)
    }
    r.data = {
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      region: region.id,
      flightPoint: flightPoint?.id,
      room: room?.id,
      paymentGroup: group?.id,
      tcNo: input.tcNo,
      passportNo: input.passportNo,
      phone: input.phone,
      birthDate: input.birthDate,
      address: input.address,
      description: input.description,
    }
  }
  return rows
}

function errorMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.data.errors.map((e) => e.message).join(' ') || error.message
  }
  return error instanceof Error ? error.message : 'Kayıt oluşturulamadı.'
}

/**
 * Doğrulanmış satırları sırayla kaydeder; bir satırın hatası diğerlerini durdurmaz.
 * Yeni ödeme grupları ilk üyesi eklenirken oluşturulur; hiç üyesi eklenemeyen grup silinir.
 */
export async function createRows(req: PayloadRequest, rows: ImportRow[]): Promise<ImportRow[]> {
  type NewGroup = { id: number; members: { id: number; phone?: string | null }[] }
  const newGroups = new Map<string, NewGroup>()
  for (const r of rows) {
    if (!r.data || r.errors.length) continue
    try {
      let group = r.newGroupName ? newGroups.get(r.newGroupName) : undefined
      if (r.newGroupName && !group) {
        const doc = await req.payload.create({
          collection: 'payment-groups',
          data: { name: r.newGroupName },
          req,
          overrideAccess: false,
        })
        group = { id: doc.id, members: [] }
        newGroups.set(r.newGroupName, group)
      }
      if (group) r.data.paymentGroup = group.id
      const doc = await req.payload.create({
        collection: 'pilgrims',
        data: r.data,
        req,
        overrideAccess: false,
      })
      group?.members.push(doc)
      r.created = true
    } catch (error) {
      r.errors.push(errorMessage(error))
    }
  }

  // Sorumlu: telefonu olan ilk üye. Hiç üyesi eklenemeyen grup boş kalmasın diye silinir.
  for (const [name, group] of newGroups) {
    const responsible = group.members.find((m) => m.phone) ?? group.members[0]
    if (responsible) {
      await req.payload.update({
        collection: 'payment-groups',
        id: group.id,
        data: { responsible: responsible.id },
        req,
      })
    } else {
      await req.payload.delete({ collection: 'payment-groups', id: group.id, req })
      for (const r of rows) if (r.newGroupName === name) delete r.newGroupName
    }
  }
  return rows
}

export function summarize(rows: ImportRow[], dryRun: boolean): ImportResult {
  const results: ImportRowResult[] = rows.map((r) => ({
    row: r.row,
    fullName: `${r.input.firstName} ${r.input.lastName}`.trim(),
    regionName: r.input.regionName,
    roomNumber: r.input.roomNumber,
    status: (dryRun ? r.data && !r.errors.length : r.created) ? 'ok' : 'error',
    errors: r.errors,
  }))
  const ok = results.filter((r) => r.status === 'ok').length
  const newGroups = [
    ...new Set(
      rows
        .filter((r) => r.newGroupName && (dryRun ? !r.errors.length : r.created))
        .map((r) => r.newGroupName!),
    ),
  ]
  return { dryRun, total: rows.length, ok, failed: rows.length - ok, rows: results, newGroups }
}

/** Boş şablon: başlıklar, cinsiyet/bölge açılır listeleri ve açıklama sayfası. */
export async function buildTemplate(req: PayloadRequest): Promise<ArrayBuffer> {
  const [{ docs: regions }, { docs: flightPoints }] = await Promise.all([
    req.payload.find({
      collection: 'regions',
      where: { active: { equals: true } },
      select: { name: true },
      sort: 'name',
      pagination: false,
      depth: 0,
      req,
    }),
    req.payload.find({
      collection: 'flight-points',
      where: { active: { equals: true } },
      select: { name: true },
      sort: 'name',
      pagination: false,
      depth: 0,
      req,
    }),
  ])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Vumre'

  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = IMPORT_COLUMNS.map((c) => ({
    key: c.key,
    header: c.required ? `${c.header} *` : c.header,
    width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }))
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.eachCell((cell, colNumber) => {
    const required = IMPORT_COLUMNS[colNumber - 1]?.required
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: required ? 'FFFDE68A' : 'FFE5E7EB' },
    }
    cell.numFmt = 'General'
  })

  const regionsSheet = workbook.addWorksheet(REGIONS_SHEET_NAME)
  regionsSheet.columns = [{ header: 'Bölge', key: 'name', width: 24 }]
  regionsSheet.getRow(1).font = { bold: true }
  regions.forEach((r) => regionsSheet.addRow({ name: r.name }))

  const flightPointsSheet = workbook.addWorksheet(FLIGHT_POINTS_SHEET_NAME)
  flightPointsSheet.columns = [{ header: 'Uçuş Noktası', key: 'name', width: 32 }]
  flightPointsSheet.getRow(1).font = { bold: true }
  flightPoints.forEach((p) => flightPointsSheet.addRow({ name: p.name }))

  const genderCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'gender') + 1
  const regionCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'region') + 1
  const flightPointCol = IMPORT_COLUMNS.findIndex((c) => c.key === 'flightPoint') + 1
  for (let row = 2; row <= MAX_IMPORT_ROWS + 1; row++) {
    sheet.getCell(row, genderCol).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Erkek,Kadın"'],
      showErrorMessage: true,
      errorTitle: 'Cinsiyet',
      error: 'Erkek veya Kadın seçin.',
    }
    if (regions.length) {
      sheet.getCell(row, regionCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'${REGIONS_SHEET_NAME}'!$A$2:$A$${regions.length + 1}`],
        showErrorMessage: true,
        errorTitle: 'Bölge',
        error: `Bölgeyi "${REGIONS_SHEET_NAME}" sayfasındaki listeden seçin.`,
      }
    }
    if (flightPoints.length) {
      sheet.getCell(row, flightPointCol).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'${FLIGHT_POINTS_SHEET_NAME}'!$A$2:$A$${flightPoints.length + 1}`],
        showErrorMessage: true,
        errorTitle: 'Uçuş noktası',
        error: `Uçuş noktasını "${FLIGHT_POINTS_SHEET_NAME}" sayfasındaki listeden seçin.`,
      }
    }
  }

  const info = workbook.addWorksheet('Bilgi')
  info.columns = [{ width: 110 }]
  ;[
    'Umreci toplu yükleme şablonu',
    '',
    `• Kayıtları "${SHEET_NAME}" sayfasına, 2. satırdan başlayarak her satıra bir kişi olacak şekilde girin. Başlık satırını değiştirmeyin.`,
    '• * işaretli sütunlar zorunludur: Ad, Soyad, Cinsiyet (Erkek / Kadın), Bölge.',
    `• Bölge, sistemde kayıtlı aktif bölgelerden biri olmalıdır (liste "${REGIONS_SHEET_NAME}" sayfasında).`,
    '• TC Kimlik No ve Pasaport No sistemde veya dosyada başka bir kişide olamaz.',
    '• Doğum tarihi gg.aa.yyyy biçiminde girilir (ör. 15.03.1960).',
    `• Uçuş Noktası: kişinin uçağa bineceği havalimanı (liste "${FLIGHT_POINTS_SHEET_NAME}" sayfasında). Boş bırakılırsa bölgenin uçuş noktası atanır.`,
    '• Oda No doldurulursa kişi o odaya atanır; oda aktif olmalı ve boş yeri bulunmalıdır. Boş bırakılabilir.',
    '• Ödeme Grubu: aile gibi birlikte ödeme yapan kişilere aynı grup adını yazın (ör. "Yılmaz Ailesi"). Sistemde olmayan grup otomatik oluşturulur. Bir gruptakilerin odaları aynı para biriminde olmalıdır. Boş bırakılabilir.',
    `• Tek seferde en fazla ${MAX_IMPORT_ROWS} kişi aktarılabilir.`,
    '• Hatalı satırlar aktarılmaz; yükleme ekranında satır numarasıyla birlikte listelenir.',
  ].forEach((line) => info.addRow([line]))
  info.getRow(1).font = { bold: true, size: 14 }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

export const importTemplateEndpoint: Endpoint = {
  path: '/import-template',
  method: 'get',
  handler: async (req) => {
    requireAdmin(req)
    const buffer = await buildTemplate(req)
    return new Response(buffer, {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': 'attachment; filename="umreci-sablonu.xlsx"',
      },
    })
  },
}

/** `?dryRun=1` ile yalnızca doğrular (önizleme); aksi halde hatasız satırları kaydeder. */
export const importPilgrimsEndpoint: Endpoint = {
  path: '/import',
  method: 'post',
  handler: async (req) => {
    requireAdmin(req)
    await addDataAndFileToRequest(req)
    const file = req.file
    // Excel dosyası sonraki create çağrılarına upload olarak taşınmasın.
    delete req.file
    delete req.files
    if (!file) throw fileError('Bir Excel dosyası seçin.')
    if (file.size > MAX_FILE_SIZE) throw fileError('Dosya en fazla 5 MB olabilir.')

    const dryRun = ['1', 'true'].includes(req.searchParams.get('dryRun') ?? '')
    const rows = await resolveRows(req, await readWorkbook(file.data))
    if (!dryRun) await createRows(req, rows)
    return Response.json(summarize(rows, dryRun))
  },
}
