// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { backfillCashboxes, getCashboxBalances, getCashboxLedger } from '@/lib/cash'

let payload: Payload
let req: PayloadRequest
let seq = 0
const suffix = Date.now().toString(36)
type Slug = 'cash-transfers' | 'expenses' | 'cashboxes' | 'users'
const created: { collection: Slug; id: number }[] = []

type Currency = 'USD' | 'EUR' | 'SAR' | 'TRY'

async function createCashbox(currency: Currency, extra: { active?: boolean } = {}) {
  const doc = await payload.create({
    collection: 'cashboxes',
    data: { name: `Kasa ${suffix}-${++seq}`, currency, kind: 'cash', ...extra },
    req,
  })
  created.push({ collection: 'cashboxes', id: doc.id })
  return doc
}

async function spend(
  cashbox: number | undefined,
  amount: number,
  paidAt = new Date().toISOString(),
) {
  const doc = await payload.create({
    collection: 'expenses',
    data: { description: `Gider ${suffix}`, category: 'hotel', cashbox, amount, paidAt } as never,
    req,
  })
  created.push({ collection: 'expenses', id: doc.id })
  return doc
}

async function transfer(from: number, to: number, amount: number, toAmount?: number) {
  const doc = await payload.create({
    collection: 'cash-transfers',
    data: { from, to, amount, toAmount, transferredAt: new Date().toISOString() },
    req,
  })
  created.push({ collection: 'cash-transfers', id: doc.id })
  return doc
}

const balanceOf = async (id: number) => (await getCashboxBalances(req)).find((b) => b.id === id)!

/** Doğrulama hatasının alan mesajı (ValidationError ayrıntıyı `data.errors` içinde taşır). */
async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    const errors = (e as { data?: { errors?: { message: string }[] } }).data?.errors
    return errors?.map((x) => x.message).join(' ') || (e as Error).message
  }
  throw new Error('Hata bekleniyordu.')
}

describe('Kasalar, giderler ve virman', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `cash-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
  })

  afterAll(async () => {
    const order: Slug[] = ['cash-transfers', 'expenses', 'cashboxes', 'users']
    for (const collection of order) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
  })

  it('gider kasasız kaydedilmez; para birimi ve şekli kasadan alır, bakiyeyi düşer', async () => {
    expect(await errorOf(spend(undefined, 10))).toMatch(/Kasa seçin/)

    const box = await createCashbox('SAR')
    const expense = await spend(box.id, 1234.567)
    expect(expense).toMatchObject({ amount: 1234.57, currency: 'SAR', method: 'cash' })
    expect(expense.paidBy).toBeTruthy()
    // Bakiye aşımı engellenmez; kasa eksiye düşer.
    expect(await balanceOf(box.id)).toMatchObject({ expense: 1234.57, balance: -1234.57 })
  })

  it('pasif kasaya hareket girilmez', async () => {
    const box = await createCashbox('USD', { active: false })
    expect(await errorOf(spend(box.id, 10))).toMatch(/pasif/)
  })

  it('aynı dövizde virman tutarı aynen aktarır, farklı dövizde giren tutar ister', async () => {
    const usd = await createCashbox('USD')
    const usd2 = await createCashbox('USD')
    const sar = await createCashbox('SAR')

    expect(await errorOf(transfer(usd.id, usd.id, 10))).toMatch(/aynı olamaz/)
    const same = await transfer(usd.id, usd2.id, 100.005, 999)
    expect(same).toMatchObject({ amount: 100.01, toAmount: 100.01 })

    expect(await errorOf(transfer(usd2.id, sar.id, 50))).toMatch(/SAR tutarını girin/)
    await transfer(usd2.id, sar.id, 50, 187.5)

    expect(await balanceOf(usd.id)).toMatchObject({ transferOut: 100.01, balance: -100.01 })
    expect(await balanceOf(usd2.id)).toMatchObject({
      transferIn: 100.01,
      transferOut: 50,
      balance: 50.01,
    })
    expect(await balanceOf(sar.id)).toMatchObject({ transferIn: 187.5, balance: 187.5 })
  })

  it('hareketi olan kasa silinmez, para birimi değişmez; hareketsiz kasa silinir', async () => {
    const box = await createCashbox('EUR')
    await spend(box.id, 5)
    await expect(payload.delete({ collection: 'cashboxes', id: box.id, req })).rejects.toThrow(
      /silinemez/,
    )
    expect(
      await errorOf(
        payload.update({ collection: 'cashboxes', id: box.id, data: { currency: 'USD' }, req }),
      ),
    ).toMatch(/değiştirilemez/)

    const empty = await createCashbox('EUR')
    await payload.delete({ collection: 'cashboxes', id: empty.id, req })
  })

  it('döküm tarih sırasıyla yürüyen bakiye ve devreden bakiye verir', async () => {
    const box = await createCashbox('TRY')
    const other = await createCashbox('TRY')
    await spend(box.id, 300, '2026-01-10T12:00:00.000Z')
    await spend(box.id, 200, '2026-01-20T12:00:00.000Z')
    await transfer(other.id, box.id, 1000)

    const all = await getCashboxLedger(req, box.id)
    expect(all.cashbox.balance).toBe(500)
    expect(all.ledger.entries.map((e) => [e.type, e.balance])).toEqual([
      ['expense', -300],
      ['expense', -500],
      ['transfer-in', 500],
    ])
    expect(all.ledger.entries[2]!.description).toContain(other.name)

    const range = await getCashboxLedger(req, box.id, { from: '2026-01-15', to: '2026-01-31' })
    expect(range.ledger).toMatchObject({ opening: -300, totalOut: 200, closing: -500 })
    expect(range.ledger.entries).toHaveLength(1)
  })

  it('kasası olmayan eski kayıtları döviz ve şekle göre kasaya bağlar', async () => {
    const box = await createCashbox('EUR')
    const expense = await spend(box.id, 42)
    // Kasa sistemi öncesi kayıt gibi: kasa bağlantısı yok.
    await payload.db.updateOne({ collection: 'expenses', id: expense.id, data: { cashbox: null } })

    const { docs: before } = await payload.find({
      collection: 'cashboxes',
      where: { name: { equals: 'Nakit EUR' } },
      limit: 1,
    })
    await backfillCashboxes(payload)
    await backfillCashboxes(payload)

    const after = await payload.findByID({ collection: 'expenses', id: expense.id, depth: 1 })
    expect(after.cashbox).toMatchObject({ name: 'Nakit EUR', currency: 'EUR', kind: 'cash' })
    const { totalDocs } = await payload.count({
      collection: 'cashboxes',
      where: { name: { equals: 'Nakit EUR' } },
    })
    expect(totalDocs).toBe(1)

    // Test öncesinde yoksa açılan kasayı da temizle (önce gider silinmeli).
    if (!before.length && typeof after.cashbox === 'object' && after.cashbox) {
      await payload.delete({ collection: 'expenses', id: expense.id })
      await payload.delete({ collection: 'cashboxes', id: after.cashbox.id })
    }
  })
})
