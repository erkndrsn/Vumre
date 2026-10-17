// @vitest-environment node
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readWorkbook, resolveRows } from '@/lib/pilgrimImport'
import { createLocalReq } from 'payload'
import ExcelJS from 'exceljs'

let payload: Payload
const suffix = Date.now().toString(36)
let izmirId: number
let istanbulId: number
let aydinId: number
// Testler ortak veritabanında çalışır; mevcut ana nokta testten sonra geri yüklenir.
let previousMainId: number | null = null
const created: { collection: 'pilgrims' | 'regions' | 'flight-points'; id: number }[] = []

async function createPilgrim(data: { region: number; flightPoint?: number | null }) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName: 'Uçuş', lastName: `Test ${suffix}`, gender: 'male', ...data },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

const idOf = (value: unknown) =>
  value && typeof value === 'object' ? (value as { id: number }).id : value

describe('Uçuş noktaları', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const main = await payload.find({
      collection: 'flight-points',
      where: { isMain: { equals: true } },
      limit: 1,
      depth: 0,
    })
    previousMainId = main.docs[0]?.id ?? null

    const izmir = await payload.create({
      collection: 'flight-points',
      data: { name: `İzmir Adnan Menderes ${suffix}`, city: `İzmir ${suffix}`, airportCode: 'adb' },
    })
    izmirId = izmir.id
    created.push({ collection: 'flight-points', id: izmir.id })
    const istanbul = await payload.create({
      collection: 'flight-points',
      data: { name: `İstanbul Havalimanı ${suffix}`, city: `İstanbul ${suffix}`, isMain: true },
    })
    istanbulId = istanbul.id
    created.push({ collection: 'flight-points', id: istanbul.id })

    // Aydın'da havalimanı yok; umreciler İzmir'den uçar.
    const aydin = await payload.create({
      collection: 'regions',
      data: { name: `Aydın ${suffix}`, defaultFlightPoint: izmirId },
    })
    aydinId = aydin.id
    created.push({ collection: 'regions', id: aydin.id })
  })

  afterAll(async () => {
    for (const collection of ['pilgrims', 'regions', 'flight-points'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
    if (previousMainId) {
      await payload.update({
        collection: 'flight-points',
        id: previousMainId,
        data: { isMain: true },
      })
    }
  })

  it('havalimanı kodunu büyük harfe çevirir', async () => {
    const izmir = await payload.findByID({ collection: 'flight-points', id: izmirId })
    expect(izmir.airportCode).toBe('ADB')
  })

  it('yalnızca bir ana uçuş noktası olur', async () => {
    const { docs } = await payload.find({
      collection: 'flight-points',
      where: { isMain: { equals: true } },
      depth: 0,
    })
    expect(docs.map((d) => d.id)).toEqual([istanbulId])

    await payload.update({ collection: 'flight-points', id: izmirId, data: { isMain: true } })
    const istanbul = await payload.findByID({ collection: 'flight-points', id: istanbulId })
    expect(istanbul.isMain).toBe(false)
    await payload.update({ collection: 'flight-points', id: istanbulId, data: { isMain: true } })
  })

  it('uçuş noktası seçilmezse bölgenin noktası atanır', async () => {
    const pilgrim = await createPilgrim({ region: aydinId })
    expect(idOf(pilgrim.flightPoint)).toBe(izmirId)
  })

  it('seçilen uçuş noktası korunur', async () => {
    const pilgrim = await createPilgrim({ region: aydinId, flightPoint: istanbulId })
    expect(idOf(pilgrim.flightPoint)).toBe(istanbulId)
  })

  it('bölge değişince eski bölgenin noktası yeni bölgeninkine geçer', async () => {
    const other = await payload.create({
      collection: 'regions',
      data: { name: `İstanbul Bölgesi ${suffix}`, defaultFlightPoint: istanbulId },
    })
    created.push({ collection: 'regions', id: other.id })
    const pilgrim = await createPilgrim({ region: aydinId })
    const updated = await payload.update({
      collection: 'pilgrims',
      id: pilgrim.id,
      data: { region: other.id },
    })
    expect(idOf(updated.flightPoint)).toBe(istanbulId)

    // Bölge değişmeden yapılan güncelleme boş bırakılan noktayı doldurmaz.
    const cleared = await payload.update({
      collection: 'pilgrims',
      id: pilgrim.id,
      data: { flightPoint: null, phone: '05550000000' },
    })
    expect(cleared.flightPoint ?? null).toBeNull()

    // Elle seçilmiş farklı nokta bölge değişse de korunur.
    const manual = await createPilgrim({ region: other.id, flightPoint: izmirId })
    const moved = await payload.update({
      collection: 'pilgrims',
      id: manual.id,
      data: { region: aydinId },
    })
    expect(idOf(moved.flightPoint)).toBe(izmirId)
    const movedBack = await payload.update({
      collection: 'pilgrims',
      id: manual.id,
      data: { region: other.id },
    })
    expect(idOf(movedBack.flightPoint)).toBe(istanbulId)
  })

  it('kullanımdaki uçuş noktası silinemez', async () => {
    await expect(payload.delete({ collection: 'flight-points', id: izmirId })).rejects.toThrow(
      /umreci|bölge/,
    )
  })

  it('Excel içe aktarmada uçuş noktası kod ya da adla eşleşir', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Umreciler')
    sheet.addRow(['Ad', 'Soyad', 'Cinsiyet', 'Bölge', 'Uçuş Noktası'])
    sheet.addRow(['Ali', 'Kod', 'Erkek', `Aydın ${suffix}`, 'adb'])
    sheet.addRow(['Ayşe', 'Ad', 'Kadın', `Aydın ${suffix}`, `İstanbul Havalimanı ${suffix}`])
    sheet.addRow(['Veli', 'Yok', 'Erkek', `Aydın ${suffix}`, 'Hayali Havalimanı'])
    sheet.addRow(['Can', 'Boş', 'Erkek', `Aydın ${suffix}`, ''])
    const buffer = await workbook.xlsx.writeBuffer()

    const req = await createLocalReq({}, payload)
    const rows = await resolveRows(req, await readWorkbook(buffer))
    expect(rows[0].data?.flightPoint).toBe(izmirId)
    expect(rows[1].data?.flightPoint).toBe(istanbulId)
    expect(rows[2].errors.join(' ')).toMatch(/uçuş noktası yok/)
    // Boşsa kayıt sırasında bölgenin noktası atanır.
    expect(rows[3].data?.flightPoint).toBeUndefined()
  })
})
