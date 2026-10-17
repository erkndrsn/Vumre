import ExcelJS from 'exceljs'
import type { Endpoint, PayloadRequest } from 'payload'

import type { Pilgrim } from '../payload-types'
import { ageOn, isInfant } from '../utils/childPricing'
import { notArchived } from './rooms'
import { requireAdmin } from './access'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NO_REGION_SHEET = 'Bölgesiz'

interface ExportColumn {
  header: string
  width: number
  numFmt?: string
  value: (p: Pilgrim) => ExcelJS.CellValue
}

const relationName = <T extends object>(value: number | T | null | undefined, key: keyof T) =>
  value && typeof value === 'object' ? ((value[key] as string | null | undefined) ?? null) : null

const trCompare = (a: string, b: string) => a.localeCompare(b, 'tr', { sensitivity: 'base' })

const GENDER_LABELS: Record<string, string> = { male: 'Erkek', female: 'Kadın' }

/** Doğum tarihi gün olarak yazılır; saat dilimi kaymasın diye UTC gün ortası kullanılır. */
function birthDay(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

// Başlıklar içe aktarma şablonuyla aynı tutulur; dışa aktarılan dosya tanıdık gelsin.
export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Sıra', width: 6, value: () => null },
  { header: 'Ad', width: 16, value: (p) => p.firstName },
  { header: 'Soyad', width: 16, value: (p) => p.lastName },
  { header: 'Cinsiyet', width: 10, value: (p) => (p.gender ? GENDER_LABELS[p.gender] : null) },
  {
    header: 'Doğum Tarihi',
    width: 13,
    numFmt: 'dd.mm.yyyy',
    value: (p) => birthDay(p.birthDate),
  },
  {
    header: 'Yaş',
    width: 8,
    value: (p) => (isInfant(p.birthDate) ? 'Bebek' : ageOn(p.birthDate)),
  },
  { header: 'TC Kimlik No', width: 15, numFmt: '@', value: (p) => p.tcNo ?? null },
  { header: 'Pasaport No', width: 14, numFmt: '@', value: (p) => p.passportNo ?? null },
  { header: 'Telefon', width: 15, numFmt: '@', value: (p) => p.phone ?? null },
  { header: 'Uçuş Noktası', width: 24, value: (p) => relationName(p.flightPoint, 'name') },
  { header: 'Oda No', width: 10, numFmt: '@', value: (p) => relationName(p.room, 'roomNumber') },
  { header: 'Ödeme Grubu', width: 18, value: (p) => relationName(p.paymentGroup, 'name') },
  { header: 'Oda Ücreti', width: 12, numFmt: '#,##0.00', value: (p) => p.roomPrice ?? null },
  { header: 'Para Birimi', width: 11, value: (p) => p.roomCurrency ?? null },
  { header: 'Adres', width: 30, value: (p) => p.address ?? null },
  { header: 'Açıklama', width: 30, value: (p) => p.description ?? null },
]

/** Excel sayfa adı: en fazla 31 karakter, `[]:*?/\` olmadan ve kitapta tekil. */
export function sheetName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/^'+|'+$/g, '')
      .trim() || 'Bölge'
  let candidate = base.slice(0, 31)
  for (let n = 2; used.has(candidate.toLocaleLowerCase('tr')); n++) {
    const tail = ` (${n})`
    candidate = `${base.slice(0, 31 - tail.length)}${tail}`
  }
  used.add(candidate.toLocaleLowerCase('tr'))
  return candidate
}

function addPilgrimSheet(workbook: ExcelJS.Workbook, name: string, pilgrims: Pilgrim[]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = EXPORT_COLUMNS.map((c) => ({
    header: c.header,
    width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }))
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    cell.numFmt = 'General'
  })
  pilgrims.forEach((p, i) => {
    sheet.addRow(EXPORT_COLUMNS.map((c, col) => (col === 0 ? i + 1 : c.value(p))))
  })
  if (pilgrims.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: EXPORT_COLUMNS.length },
    }
  }
}

/**
 * Umrecileri bölgelere göre ayrı sayfalara yazar. Bölgeler ada göre sıralanır; umrecisi
 * olmayan bölge sayfası açılmaz (yalnızca bir bölge istenmişse boş da olsa açılır).
 * Bölgesi olmayan eski kayıtlar en sonda "Bölgesiz" sayfasında toplanır.
 */
export async function buildPilgrimExport(
  req: PayloadRequest,
  regionId?: number,
): Promise<ArrayBuffer> {
  const [regions, pilgrims] = await Promise.all([
    req.payload.find({
      collection: 'regions',
      where: regionId ? { id: { equals: regionId } } : undefined,
      select: { name: true },
      pagination: false,
      depth: 0,
      req,
      overrideAccess: false,
    }),
    req.payload.find({
      collection: 'pilgrims',
      where: regionId ? { and: [notArchived, { region: { equals: regionId } }] } : notArchived,
      pagination: false,
      depth: 1,
      // Oda doluluğu her oda için ayrı sayım yapar; listede gerekmez.
      context: { skipOccupancy: true },
      req,
      overrideAccess: false,
    }),
  ])

  // Veritabanı sıralaması Türkçe harfleri (İ, Ç, Ş…) alfabenin sonuna atar.
  const byRegion = new Map<string, Pilgrim[]>()
  const sorted = [...pilgrims.docs].sort((a, b) => trCompare(a.fullName ?? '', b.fullName ?? ''))
  for (const p of sorted) {
    const id = p.region && typeof p.region === 'object' ? p.region.id : p.region
    const key = id ? String(id) : ''
    byRegion.set(key, [...(byRegion.get(key) ?? []), p])
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Vumre'
  const used = new Set<string>()
  for (const region of [...regions.docs].sort((a, b) => trCompare(a.name, b.name))) {
    const list = byRegion.get(String(region.id)) ?? []
    if (!list.length && !regionId) continue
    addPilgrimSheet(workbook, sheetName(region.name, used), list)
  }
  const noRegion = byRegion.get('') ?? []
  if (noRegion.length) addPilgrimSheet(workbook, sheetName(NO_REGION_SHEET, used), noRegion)
  if (!workbook.worksheets.length) addPilgrimSheet(workbook, 'Umreciler', [])

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

/** `?region=<id>` verilirse yalnızca o bölge dışa aktarılır. */
export const exportPilgrimsEndpoint: Endpoint = {
  path: '/export',
  method: 'get',
  handler: async (req) => {
    requireAdmin(req)
    const regionParam = Number(req.searchParams.get('region'))
    const regionId = Number.isInteger(regionParam) && regionParam > 0 ? regionParam : undefined
    const buffer = await buildPilgrimExport(req, regionId)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    return new Response(buffer, {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="umreciler-${day}.xlsx"`,
      },
    })
  },
}
