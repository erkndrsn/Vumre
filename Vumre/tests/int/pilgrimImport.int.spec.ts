// @vitest-environment node
import ExcelJS from 'exceljs'
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  buildTemplate,
  createRows,
  readWorkbook,
  resolveRows,
  summarize,
} from '@/lib/pilgrimImport'
import { isValidTcNo } from '@/lib/tcNo'

let payload: Payload
let req: PayloadRequest
const suffix = Date.now().toString(36)
let regionName: string
const created: {
  collection: 'pilgrims' | 'payment-groups' | 'rooms' | 'room-types' | 'regions' | 'users'
  id: number
}[] = []

/** İlk 9 haneden geçerli bir TC Kimlik No üretir. */
function makeTc(first9: string): string {
  const d = first9.split('').map(Number)
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const d10 = (((odd * 7 - even) % 10) + 10) % 10
  const d11 = (d.reduce((s, n) => s + n, 0) + d10) % 10
  return `${first9}${d10}${d11}`
}
// Her test çalıştırmasında farklı TC'ler (unique alan).
const tcBase = String(100000000 + (Date.now() % 800000000)).slice(0, 9)
const tc = (n: number) => makeTc(String(Number(tcBase) + n).padStart(9, '1'))

async function workbook(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Liste')
  rows.forEach((r) => ws.addRow(r))
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

describe('Excel ile toplu umreci yükleme', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `import-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)

    regionName = `İçe Aktarım Bölgesi ${suffix}`
    const region = await payload.create({ collection: 'regions', data: { name: regionName } })
    created.push({ collection: 'regions', id: region.id })
  })

  afterAll(async () => {
    const order = ['payment-groups', 'pilgrims', 'rooms', 'room-types', 'regions', 'users'] as const
    for (const collection of order) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('başlık yazımlarını tanır ve satırları biçim yönünden doğrular', async () => {
    const valid = tc(1)
    const file = await workbook([
      ['Adı', 'SOYADI', 'cinsiyet', 'Bölge', 'TC No', 'Doğum Tarihi', 'Bilinmeyen'],
      ['Ali', 'Yılmaz', 'Erkek', regionName, Number(valid), new Date(Date.UTC(1960, 2, 15)), 'x'],
      [],
      ['Ayşe', 'Kaya', 'K', regionName, '', '01.02.1970'],
      ['', 'Demir', 'Bilinmez', regionName, '12345678901', '31.02.1970'],
      ['Veli', 'Can', 'E', regionName, valid],
    ])
    const rows = await readWorkbook(file)

    expect(isValidTcNo(valid)).toBe(true)
    expect(rows.map((r) => r.row)).toEqual([2, 4, 5, 6])
    expect(rows[0]!.errors).toEqual([])
    expect(rows[0]!.input).toMatchObject({ gender: 'male', tcNo: valid })
    expect(rows[0]!.input.birthDate?.slice(0, 10)).toBe('1960-03-15')
    expect(rows[1]!.input).toMatchObject({ gender: 'female' })
    expect(rows[1]!.input.birthDate?.slice(0, 10)).toBe('1970-02-01')

    const errors = rows[2]!.errors.join(' ')
    expect(errors).toContain('Ad boş')
    expect(errors).toContain('Cinsiyet')
    expect(errors).toContain('TC Kimlik No')
    expect(errors).toContain('Doğum tarihi')

    expect(rows[3]!.errors.join(' ')).toContain('2. satırda da var')
  })

  it('zorunlu başlık eksikse dosyayı reddeder', async () => {
    const file = await workbook([
      ['Ad', 'Soyad'],
      ['Ali', 'Yılmaz'],
    ])
    await expect(readWorkbook(file)).rejects.toThrow(/Cinsiyet, Bölge/)
  })

  it('şablonun başlıkları okunabilir', async () => {
    const template = await buildTemplate(req)
    await expect(readWorkbook(template)).rejects.toThrow(/aktarılacak satır bulunamadı/)
  })

  it('bölge, mükerrer kayıt ve oda kapasitesini kontrol edip geçerli satırları kaydeder', async () => {
    const type = await payload.create({
      collection: 'room-types',
      data: { name: `İkili ${suffix}`, capacity: 2, pricePerPerson: 900, currency: 'USD' },
    })
    created.push({ collection: 'room-types', id: type.id })
    const room = await payload.create({
      collection: 'rooms',
      data: { roomNumber: `IMP-${suffix}`, roomType: type.id },
    })
    created.push({ collection: 'rooms', id: room.id })

    const existingTc = tc(2)
    const existing = await payload.create({
      collection: 'pilgrims',
      data: {
        firstName: 'Mevcut',
        lastName: 'Kişi',
        gender: 'male',
        region: (
          await payload.find({ collection: 'regions', where: { name: { equals: regionName } } })
        ).docs[0]!.id,
        tcNo: existingTc,
      },
    })
    created.push({ collection: 'pilgrims', id: existing.id })

    const file = await workbook([
      ['Ad', 'Soyad', 'Cinsiyet', 'Bölge', 'TC Kimlik No', 'Oda No'],
      ['Bir', 'Test', 'Erkek', regionName.toLocaleUpperCase('tr'), tc(3), room.roomNumber],
      ['İki', 'Test', 'Erkek', regionName, tc(4), room.roomNumber],
      ['Üç', 'Test', 'Erkek', regionName, tc(5), room.roomNumber],
      ['Dört', 'Test', 'Kadın', 'Olmayan Bölge', '', ''],
      ['Beş', 'Test', 'Kadın', regionName, existingTc, ''],
    ])

    const preview = summarize(await resolveRows(req, await readWorkbook(file)), true)
    expect(preview).toMatchObject({ total: 5, ok: 2, failed: 3 })
    const errorOf = (row: number) => preview.rows.find((r) => r.row === row)!.errors.join(' ')
    expect(errorOf(4)).toContain('dolu (2/2)')
    expect(errorOf(5)).toContain('bölge yok')
    expect(errorOf(6)).toContain('zaten kayıtlı')

    // Önizleme kayıt oluşturmaz.
    const before = await payload.count({
      collection: 'pilgrims',
      where: { room: { equals: room.id } },
    })
    expect(before.totalDocs).toBe(0)

    const rows = await createRows(req, await resolveRows(req, await readWorkbook(file)))
    const result = summarize(rows, false)
    expect(result).toMatchObject({ ok: 2, failed: 3 })

    const { docs } = await payload.find({
      collection: 'pilgrims',
      where: { room: { equals: room.id } },
      sort: 'firstName',
    })
    docs.forEach((d) => created.push({ collection: 'pilgrims', id: d.id }))
    expect(docs.map((d) => d.fullName)).toEqual(['Bir Test', 'İki Test'])
    expect(docs[0]).toMatchObject({ roomPrice: 900, roomCurrency: 'USD' })
  })

  it('ödeme grubu sütununu mevcut gruba eşler, olmayanı oluşturur', async () => {
    const usd = await payload.create({
      collection: 'room-types',
      data: { name: `Grup USD ${suffix}`, capacity: 4, pricePerPerson: 1000, currency: 'USD' },
    })
    const eur = await payload.create({
      collection: 'room-types',
      data: { name: `Grup EUR ${suffix}`, capacity: 4, pricePerPerson: 800, currency: 'EUR' },
    })
    created.push({ collection: 'room-types', id: usd.id }, { collection: 'room-types', id: eur.id })
    const usdRoom = await payload.create({
      collection: 'rooms',
      data: { roomNumber: `GU-${suffix}`, roomType: usd.id },
    })
    const eurRoom = await payload.create({
      collection: 'rooms',
      data: { roomNumber: `GE-${suffix}`, roomType: eur.id },
    })
    created.push({ collection: 'rooms', id: usdRoom.id }, { collection: 'rooms', id: eurRoom.id })
    const existingGroup = await payload.create({
      collection: 'payment-groups',
      data: { name: `Mevcut Aile ${suffix}` },
    })
    created.push({ collection: 'payment-groups', id: existingGroup.id })

    const newName = `Yeni Aile ${suffix}`
    const file = await workbook([
      ['Ad', 'Soyad', 'Cinsiyet', 'Bölge', 'Oda No', 'Telefon', 'Aile'],
      ['Gamze', 'Grup', 'Kadın', regionName, usdRoom.roomNumber, '', newName],
      [
        'Gökhan',
        'Grup',
        'Erkek',
        regionName,
        usdRoom.roomNumber,
        '05321112233',
        newName.toLocaleUpperCase('tr'),
      ],
      ['Gül', 'Grup', 'Kadın', regionName, eurRoom.roomNumber, '', newName],
      ['Gani', 'Grup', 'Erkek', regionName, '', '', existingGroup.name],
    ])

    const preview = summarize(await resolveRows(req, await readWorkbook(file)), true)
    expect(preview).toMatchObject({ ok: 3, failed: 1, newGroups: [newName] })
    expect(preview.rows.find((r) => r.row === 4)!.errors.join(' ')).toContain('USD')
    expect(
      (await payload.count({ collection: 'payment-groups', where: { name: { equals: newName } } }))
        .totalDocs,
    ).toBe(0)

    const result = summarize(
      await createRows(req, await resolveRows(req, await readWorkbook(file))),
      false,
    )
    expect(result).toMatchObject({ ok: 3, newGroups: [newName] })

    const { docs: groups } = await payload.find({
      collection: 'payment-groups',
      where: { name: { equals: newName } },
      depth: 0,
    })
    expect(groups).toHaveLength(1)
    created.push({ collection: 'payment-groups', id: groups[0]!.id })
    const { docs: members } = await payload.find({
      collection: 'pilgrims',
      where: { lastName: { equals: 'Grup' }, region: { exists: true } },
      depth: 0,
      sort: 'firstName',
    })
    members.forEach((d) => created.push({ collection: 'pilgrims', id: d.id }))
    const groupOf = (name: string) => members.find((m) => m.firstName === name)?.paymentGroup
    expect(groupOf('Gamze')).toBe(groups[0]!.id)
    expect(groupOf('Gökhan')).toBe(groups[0]!.id)
    expect(groupOf('Gani')).toBe(existingGroup.id)
    // Sorumlu: telefonu olan ilk üye.
    expect(groups[0]!.responsible).toBe(members.find((m) => m.firstName === 'Gökhan')!.id)
  })
})
