// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let managerReq: PayloadRequest
const suffix = Date.now().toString(36)
let ownPilgrim: number
let otherPilgrim: number
const created: { collection: 'pilgrims' | 'regions' | 'users'; id: number }[] = []

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const file = (name: string) => ({ data: png, mimetype: 'image/png', name, size: png.length })

const asManager = { overrideAccess: false } as const

async function upload(pilgrim: number, kind: 'idCard' | 'other', req?: PayloadRequest) {
  return payload.create({
    collection: 'pilgrim-documents',
    data: { pilgrim, kind },
    file: file(`doc-${suffix}.png`),
    ...(req ? { req, ...asManager } : {}),
  })
}

describe('Umreci dokümanları', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const regions: number[] = []
    for (const name of ['Kendi', 'Diğer']) {
      const region = await payload.create({
        collection: 'regions',
        data: { name: `Doküman ${name} ${suffix}` },
      })
      created.push({ collection: 'regions', id: region.id })
      regions.push(region.id)
    }
    for (const [i, region] of regions.entries()) {
      const p = await payload.create({
        collection: 'pilgrims',
        data: { firstName: `Doküman${i}`, lastName: 'Test', gender: 'female', region },
      })
      created.push({ collection: 'pilgrims', id: p.id })
      if (i === 0) ownPilgrim = p.id
      else otherPilgrim = p.id
    }
    const manager = await payload.create({
      collection: 'users',
      data: {
        username: `doc-manager-${suffix}`,
        password: 'test-1234',
        role: 'regionManager',
        regions: [regions[0]!],
      },
    })
    created.push({ collection: 'users', id: manager.id })
    managerReq = await createLocalReq({ user: { ...manager, collection: 'users' } }, payload)
  })

  afterAll(async () => {
    for (const collection of ['pilgrims', 'users', 'regions'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('yeni kimlik resmi yüklenince eskisi silinir, diğer dokümanlar kalır', async () => {
    const first = await upload(ownPilgrim, 'idCard')
    const other = await upload(ownPilgrim, 'other')
    const second = await upload(ownPilgrim, 'idCard')

    const { docs } = await payload.find({
      collection: 'pilgrim-documents',
      where: { pilgrim: { equals: ownPilgrim } },
    })
    const ids = docs.map((d) => d.id)
    expect(ids).toContain(second.id)
    expect(ids).toContain(other.id)
    expect(ids).not.toContain(first.id)
  })

  it('bölge yöneticisi yalnızca kendi bölgesindeki umrecinin dokümanlarını görür ve ekler', async () => {
    const foreign = await upload(otherPilgrim, 'other')

    const own = await upload(ownPilgrim, 'other', managerReq)
    expect(own.id).toBeTruthy()
    await expect(upload(otherPilgrim, 'other', managerReq)).rejects.toThrow()

    const { docs } = await payload.find({
      collection: 'pilgrim-documents',
      where: { id: { in: [own.id, foreign.id] } },
      req: managerReq,
      ...asManager,
    })
    expect(docs.map((d) => d.id)).toEqual([own.id])

    await expect(
      payload.delete({
        collection: 'pilgrim-documents',
        id: foreign.id,
        req: managerReq,
        ...asManager,
      }),
    ).rejects.toThrow()
  })

  it('umreci silinince dokümanları da silinir', async () => {
    const p = await payload.create({
      collection: 'pilgrims',
      data: { firstName: 'Silinen', lastName: 'Test', gender: 'male', region: created[0]!.id },
    })
    await upload(p.id, 'idCard')
    await payload.delete({ collection: 'pilgrims', id: p.id })
    const { totalDocs } = await payload.count({
      collection: 'pilgrim-documents',
      where: { pilgrim: { equals: p.id } },
    })
    expect(totalDocs).toBe(0)
  })
})
