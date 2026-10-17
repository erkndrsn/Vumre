// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { testCashboxes } from '../helpers/cashboxes'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getBalances } from '@/lib/payments'
import { balanceStatus, fillReminder, whatsappPhone } from '@/utils/payments'

let payload: Payload
let req: PayloadRequest
let seq = 0
const suffix = Date.now().toString(36)
const cashboxes = testCashboxes(() => payload, suffix)
let regionId: number
const created: {
  collection: 'payments' | 'pilgrims' | 'rooms' | 'room-types' | 'regions' | 'users'
  id: number
}[] = []

type Currency = 'USD' | 'EUR' | 'SAR' | 'TRY'

async function createRoom(
  price: number,
  currency: Currency = 'USD',
  extra: {
    otherPrices?: { currency: Currency; pricePerPerson: number }[]
    childPrices?: { minAge: number; maxAge: number; price: number }[]
  } = {},
) {
  const type = await payload.create({
    collection: 'room-types',
    data: {
      name: `Tahsilat Tipi ${suffix}-${++seq}`,
      capacity: 4,
      pricePerPerson: price,
      currency,
      ...extra,
    },
  })
  created.push({ collection: 'room-types', id: type.id })
  const room = await payload.create({
    collection: 'rooms',
    data: { roomNumber: `T${seq}-${suffix}`, roomType: type.id },
  })
  created.push({ collection: 'rooms', id: room.id })
  return room
}

async function createPilgrim(firstName: string, room?: number, birthDate?: string) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: { firstName, lastName: 'Tahsilat', gender: 'male', region: regionId, room, birthDate },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

async function pay(pilgrim: number, amount: number, currency?: Currency) {
  const doc = await payload.create({
    collection: 'payments',
    data: {
      pilgrim,
      amount,
      currency,
      cashbox: await cashboxes.of(currency),
      paidAt: new Date().toISOString(),
      method: 'cash' as const,
    },
    req,
  })
  created.push({ collection: 'payments', id: doc.id })
  return doc
}

/** Doğrulama hatasının alan mesajı (ValidationError ayrıntıyı `data.errors` içinde taşır). */
async function fieldError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (e) {
    const errors = (e as { data?: { errors?: { message: string }[] } }).data?.errors
    return errors?.map((x) => x.message).join(' ') ?? String(e)
  }
  throw new Error('Hata bekleniyordu.')
}

async function balanceOf(pilgrimId: number) {
  const [row] = await getBalances(req, pilgrimId)
  return row!
}

describe('Tahsilat ve borç takibi', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `pay-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)

    const region = await payload.create({
      collection: 'regions',
      data: { name: `Tahsilat Bölgesi ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })
  })

  afterAll(async () => {
    const order = ['payments', 'pilgrims', 'rooms', 'room-types', 'regions', 'users'] as const
    for (const collection of order) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
    await cashboxes.cleanup()
  })

  it('durum ve yardımcıları hesaplar', () => {
    expect(balanceStatus(null, 0)).toBe('unpriced')
    expect(balanceStatus(1000, 0)).toBe('unpaid')
    expect(balanceStatus(1000, 400)).toBe('partial')
    expect(balanceStatus(1000, 1000)).toBe('paid')
    expect(balanceStatus(800, 1000)).toBe('overpaid')
    expect(balanceStatus(null, 100)).toBe('advance')
    expect(balanceStatus(0.3, 0.1 + 0.2)).toBe('paid')

    expect(whatsappPhone('0532 111 22 33')).toBe('905321112233')
    expect(whatsappPhone('532 111 22 33')).toBe('905321112233')
    expect(whatsappPhone('+49 151 1234 5678')).toBe('4915112345678')
    expect(whatsappPhone('123')).toBeNull()

    expect(
      fillReminder('{ad}: {kalan} / {ucret}', {
        name: 'Ali',
        balance: '500 USD',
        paid: '',
        price: '1.000 USD',
        room: '',
      }),
    ).toBe('Ali: 500 USD / 1.000 USD')
  })

  it('oda ücretine göre borcu çıkarır, ödemeleri düşer', async () => {
    const room = await createRoom(1000)
    const p = await createPilgrim('Ahmet', room.id)

    expect(await balanceOf(p.id)).toMatchObject({
      price: 1000,
      currency: 'USD',
      paid: 0,
      balance: 1000,
      status: 'unpaid',
      room: { id: room.id },
    })

    const first = await pay(p.id, 400)
    expect(first.currency).toBe('USD')
    expect(first.receivedBy).toBeTruthy()
    expect(await balanceOf(p.id)).toMatchObject({ paid: 400, balance: 600, status: 'partial' })

    await pay(p.id, 600)
    expect(await balanceOf(p.id)).toMatchObject({
      paid: 1000,
      balance: 0,
      status: 'paid',
      paymentCount: 2,
    })
  })

  it('kalan borçtan fazla tahsilat almaz', async () => {
    const room = await createRoom(500)
    const p = await createPilgrim('Mehmet', room.id)
    await pay(p.id, 300)
    await expect(pay(p.id, 250)).rejects.toThrow()
    expect((await balanceOf(p.id)).paid).toBe(300)
  })

  it('düzenlenen tahsilatın eski tutarını saymaz', async () => {
    const room = await createRoom(500)
    const p = await createPilgrim('Hasan', room.id)
    const payment = await pay(p.id, 500)
    const updated = await payload.update({
      collection: 'payments',
      id: payment.id,
      data: { amount: 450 },
      req,
    })
    expect(updated.amount).toBe(450)
    expect((await balanceOf(p.id)).balance).toBe(50)
  })

  it('odası olmayan umreciden ön ödeme alır; odaya atanınca ücretten düşer', async () => {
    const p = await createPilgrim('Odasız')
    expect((await balanceOf(p.id)).status).toBe('unpriced')

    // Üst sınır yok; para birimi kasadan gelir.
    expect(await pay(p.id, 300)).toMatchObject({ currency: 'USD', debtAmount: 300 })
    await pay(p.id, 50.5)
    expect(await balanceOf(p.id)).toMatchObject({
      price: null,
      currency: 'USD',
      paid: 350.5,
      status: 'advance',
    })
    // Ön ödemeler tek para biriminde tutulur.
    expect(await fieldError(pay(p.id, 100, 'EUR'))).toMatch(/önceki ön ödemeler USD/)

    const room = await createRoom(1000)
    await payload.update({ collection: 'pilgrims', id: p.id, data: { room: room.id } })
    expect(await balanceOf(p.id)).toMatchObject({
      price: 1000,
      paid: 350.5,
      balance: 649.5,
      status: 'partial',
    })
  })

  it('farklı para birimindeki ön ödemeyi oda tipinin oranıyla çevirir', async () => {
    const p = await createPilgrim('Kapora')
    const advance = await pay(p.id, 920, 'EUR')
    const room = await createRoom(1000, 'USD', {
      otherPrices: [{ currency: 'EUR', pricePerPerson: 920 }],
    })
    await payload.update({ collection: 'pilgrims', id: p.id, data: { room: room.id } })

    const converted = await payload.findByID({ collection: 'payments', id: advance.id, depth: 0 })
    expect(converted).toMatchObject({
      amount: 920,
      currency: 'EUR',
      debtAmount: 1000,
      debtCurrency: 'USD',
    })
    expect(await balanceOf(p.id)).toMatchObject({ paid: 1000, balance: 0, status: 'paid' })
  })

  it('ön ödemenin para biriminde fiyatı olmayan odaya atamaz', async () => {
    const p = await createPilgrim('Riyal')
    await pay(p.id, 500, 'SAR')
    const room = await createRoom(1000, 'USD')
    expect(
      await fieldError(
        payload.update({ collection: 'pilgrims', id: p.id, data: { room: room.id } }),
      ),
    ).toMatch(/SAR fiyatı olmadığı/)
    expect(await balanceOf(p.id)).toMatchObject({ currency: 'SAR', status: 'advance' })
  })

  it('odadan çıkarılan kişinin ödemesi ön ödeme olarak kalır', async () => {
    const room = await createRoom(700)
    const p = await createPilgrim('Veli', room.id)
    await pay(p.id, 200)
    await payload.update({ collection: 'pilgrims', id: p.id, data: { room: null } })
    expect(await balanceOf(p.id)).toMatchObject({
      price: null,
      currency: 'USD',
      balance: -200,
      status: 'advance',
    })
  })

  it('tahsilatı olan kişiyi farklı para birimli odaya taşımaz, silmez', async () => {
    const usd = await createRoom(1000, 'USD')
    const eur = await createRoom(900, 'EUR')
    const p = await createPilgrim('Can', usd.id)
    await pay(p.id, 100)

    await expect(
      payload.update({ collection: 'pilgrims', id: p.id, data: { room: eur.id } }),
    ).rejects.toThrow()
    await expect(payload.delete({ collection: 'pilgrims', id: p.id })).rejects.toThrow(/tahsilat/)
  })

  it('diğer para biriminde ödemeyi oda ücretlerinin oranıyla borçtan düşer', async () => {
    const room = await createRoom(1000, 'USD', {
      otherPrices: [
        { currency: 'EUR', pricePerPerson: 920 },
        { currency: 'TRY', pricePerPerson: 35000 },
      ],
    })
    const p = await createPilgrim('Ekrem', room.id)
    expect(p.roomOtherPrices?.map(({ currency, price }) => ({ currency, price }))).toEqual([
      { currency: 'EUR', price: 920 },
      { currency: 'TRY', price: 35000 },
    ])

    const eur = await pay(p.id, 460, 'EUR')
    expect(eur).toMatchObject({
      amount: 460,
      currency: 'EUR',
      debtAmount: 500,
      debtCurrency: 'USD',
    })
    expect(await balanceOf(p.id)).toMatchObject({ paid: 500, balance: 500, status: 'partial' })

    // Kalan 500 USD = 17.500 TRY; fazlası alınmaz, tamamı borcu tam kapatır.
    expect(await fieldError(pay(p.id, 17500.01, 'TRY'))).toMatch(/17\.500 TRY/)
    await pay(p.id, 17500, 'TRY')
    expect(await balanceOf(p.id)).toMatchObject({ paid: 1000, balance: 0, status: 'paid' })
  })

  it('fiyatı girilmemiş para biriminde ödeme almaz, para birimi verilmezse ana para birimi', async () => {
    const room = await createRoom(1000, 'USD', {
      otherPrices: [{ currency: 'EUR', pricePerPerson: 920 }],
    })
    const p = await createPilgrim('Fikret', room.id)
    expect(await fieldError(pay(p.id, 100, 'SAR'))).toMatch(/SAR ile ödeme alınamaz/)
    expect(await pay(p.id, 100)).toMatchObject({ currency: 'USD', debtAmount: 100 })
  })

  it('tahsilatı kasaya bağlar; kasasız veya kasanın dövizinden farklı tahsilat almaz', async () => {
    const room = await createRoom(1000, 'USD', {
      otherPrices: [{ currency: 'EUR', pricePerPerson: 920 }],
    })
    const p = await createPilgrim('Kasa', room.id)
    // Ödeme şekli kasanın türüyle değiştirilir.
    const data = {
      pilgrim: p.id,
      amount: 100,
      paidAt: new Date().toISOString(),
      method: 'card' as const,
    }

    expect(await fieldError(payload.create({ collection: 'payments', data, req }))).toMatch(
      /Kasa seçin/,
    )
    const usdBox = await cashboxes.of('USD')
    expect(
      await fieldError(
        payload.create({
          collection: 'payments',
          data: { ...data, currency: 'EUR', cashbox: usdBox },
          req,
        }),
      ),
    ).toMatch(/EUR tahsilat bu kasaya girilemez/)

    // Para birimi verilmezse kasanın dövizi; ödeme şekli kasanın türü.
    const eurBox = await cashboxes.of('EUR')
    const doc = await payload.create({
      collection: 'payments',
      data: { ...data, cashbox: eurBox },
      req,
    })
    created.push({ collection: 'payments', id: doc.id })
    expect(doc).toMatchObject({ currency: 'EUR', method: 'cash' })
  })

  it('çocuk ücretine diğer para biriminde de aynı oranı uygular, tip değişince eşitler', async () => {
    const room = await createRoom(1200, 'USD', {
      childPrices: [{ minAge: 2, maxAge: 6, price: 600 }],
      otherPrices: [{ currency: 'EUR', pricePerPerson: 1100 }],
    })
    const birthDate = new Date(Date.UTC(new Date().getUTCFullYear() - 4, 0, 1)).toISOString()
    const child = await createPilgrim('Gül', room.id, birthDate)
    expect(child.roomPrice).toBe(600)
    expect(child.roomOtherPrices?.[0]).toMatchObject({ currency: 'EUR', price: 550 })

    const typeId = typeof room.roomType === 'object' ? room.roomType.id : room.roomType
    await payload.update({
      collection: 'room-types',
      id: typeId,
      data: { otherPrices: [{ currency: 'EUR', pricePerPerson: 1080 }] },
    })
    const synced = await payload.findByID({ collection: 'pilgrims', id: child.id, depth: 0 })
    expect(synced.roomOtherPrices?.[0]).toMatchObject({ currency: 'EUR', price: 540 })
  })

  it('ana para birimini diğer para birimlerinde tekrar etmeye izin vermez', async () => {
    await expect(
      createRoom(1000, 'USD', { otherPrices: [{ currency: 'USD', pricePerPerson: 1000 }] }),
    ).rejects.toThrow()
    await expect(
      createRoom(1000, 'USD', {
        otherPrices: [
          { currency: 'EUR', pricePerPerson: 900 },
          { currency: 'EUR', pricePerPerson: 950 },
        ],
      }),
    ).rejects.toThrow()
  })
})
