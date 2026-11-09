// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { testCashboxes } from '../helpers/cashboxes'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let adminReq: PayloadRequest
let managerReq: PayloadRequest
const suffix = Date.now().toString(36)
const cashboxes = testCashboxes(() => payload, suffix)
let pilgrimId: number
const created: { collection: 'payments' | 'pilgrims' | 'regions' | 'users'; id: number }[] = []

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const file = () => ({
  data: png,
  mimetype: 'image/png',
  name: `dekont-${suffix}.png`,
  size: png.length,
})

async function pay(amount: number) {
  const doc = await payload.create({
    collection: 'payments',
    data: {
      pilgrim: pilgrimId,
      amount,
      cashbox: await cashboxes.of('USD'),
      paidAt: new Date().toISOString(),
      method: 'cash' as const,
    },
    req: adminReq,
  })
  created.push({ collection: 'payments', id: doc.id })
  return doc
}

function attach(payment: number, req: PayloadRequest = adminReq) {
  return payload.create({
    collection: 'payment-receipts',
    data: { payment },
    file: file(),
    req,
    overrideAccess: false,
  })
}

describe('Tahsilat dekontları', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const region = await payload.create({
      collection: 'regions',
      data: { name: `Dekont Bölgesi ${suffix}` },
    })
    created.push({ collection: 'regions', id: region.id })
    const pilgrim = await payload.create({
      collection: 'pilgrims',
      data: { firstName: 'Dekont', lastName: 'Test', gender: 'male', region: region.id },
    })
    pilgrimId = pilgrim.id
    created.push({ collection: 'pilgrims', id: pilgrim.id })

    const admin = await payload.create({
      collection: 'users',
      data: { username: `receipt-admin-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: admin.id })
    adminReq = await createLocalReq({ user: { ...admin, collection: 'users' } }, payload)

    const manager = await payload.create({
      collection: 'users',
      data: {
        username: `receipt-manager-${suffix}`,
        password: 'test-1234',
        role: 'regionManager',
        regions: [region.id],
      },
    })
    created.push({ collection: 'users', id: manager.id })
    managerReq = await createLocalReq({ user: { ...manager, collection: 'users' } }, payload)
  })

  afterAll(async () => {
    for (const collection of ['payments', 'pilgrims', 'users', 'regions'] as const) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
    await cashboxes.cleanup()
  })

  it('dekont tahsilata eklenir ve tahsilatla birlikte listelenir', async () => {
    const payment = await pay(100)
    const first = await attach(payment.id)
    const second = await attach(payment.id)
    expect(first.url).toContain('/payment-receipts/file/')

    const doc = await payload.findByID({ collection: 'payments', id: payment.id, depth: 1 })
    const ids = (doc.receipts?.docs ?? []).map((r) => (typeof r === 'object' ? r.id : r))
    expect(ids).toEqual([first.id, second.id])
  })

  it('tahsilat silinince dekontları da silinir', async () => {
    const payment = await pay(50)
    const receipt = await attach(payment.id)
    await payload.delete({ collection: 'payments', id: payment.id, req: adminReq })

    const { totalDocs } = await payload.count({
      collection: 'payment-receipts',
      where: { id: { equals: receipt.id } },
    })
    expect(totalDocs).toBe(0)
  })

  it('bölge yöneticisi dekont göremez ve ekleyemez', async () => {
    const payment = await pay(25)
    await attach(payment.id)

    await expect(attach(payment.id, managerReq)).rejects.toThrow()
    await expect(
      payload.find({
        collection: 'payment-receipts',
        where: { payment: { equals: payment.id } },
        req: managerReq,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})
