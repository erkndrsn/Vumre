// @vitest-environment node
import ExcelJS from 'exceljs'
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildPilgrimExport, sheetName } from '@/lib/pilgrimExport'

let payload: Payload
let req: PayloadRequest
const suffix = Date.now().toString(36)
const regionIds: number[] = []
const created: { collection: 'pilgrims' | 'regions' | 'users'; id: number }[] = []

async function sheets(buffer: ArrayBuffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb
}

describe('Umreci listesini Excel’e aktarma', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `export-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)

    for (const name of [`Aktarım A ${suffix}`, `Aktarım B ${suffix}`]) {
      const region = await payload.create({ collection: 'regions', data: { name } })
      created.push({ collection: 'regions', id: region.id })
      regionIds.push(region.id)
    }
    const people = [
      { firstName: 'Zeynep', lastName: 'Ak', gender: 'female', region: regionIds[0] },
      { firstName: 'Ahmet', lastName: 'Ak', gender: 'male', region: regionIds[0] },
      { firstName: 'Mehmet', lastName: 'Bal', gender: 'male', region: regionIds[1] },
    ] as const
    for (const data of people) {
      const doc = await payload.create({ collection: 'pilgrims', data: { ...data } })
      created.push({ collection: 'pilgrims', id: doc.id })
    }
  })

  afterAll(async () => {
    for (const collection of ['pilgrims', 'regions', 'users'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('her bölgeyi ayrı sayfaya, ada göre sıralı yazar', async () => {
    const wb = await sheets(await buildPilgrimExport(req))
    const a = wb.getWorksheet(`Aktarım A ${suffix}`)!
    const b = wb.getWorksheet(`Aktarım B ${suffix}`)!
    expect(a.getRow(1).getCell(2).value).toBe('Ad')
    expect(a.rowCount).toBe(3)
    expect(a.getRow(2).getCell(2).value).toBe('Ahmet')
    expect(a.getRow(2).getCell(4).value).toBe('Erkek')
    expect(a.getRow(3).getCell(2).value).toBe('Zeynep')
    expect(b.rowCount).toBe(2)
    expect(b.getRow(2).getCell(2).value).toBe('Mehmet')
  })

  it('bölge verilirse yalnızca o bölgeyi aktarır', async () => {
    const wb = await sheets(await buildPilgrimExport(req, regionIds[1]))
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([`Aktarım B ${suffix}`])
  })

  it('sayfa adlarını Excel kurallarına uydurur', () => {
    const used = new Set<string>()
    expect(sheetName('Ankara/Çankaya', used)).toBe('Ankara Çankaya')
    expect(sheetName('ankara/çankaya', used)).toBe('ankara çankaya (2)')
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31)
  })
})
