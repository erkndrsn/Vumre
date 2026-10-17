// @vitest-environment node
import { createLocalReq, getPayload, Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'
import { testCashboxes } from '../helpers/cashboxes'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createGroup, setGroupMembers } from '@/lib/paymentGroups'
import { getAccounts } from '@/lib/payments'
import { buildAccounts, fillReminder, type MemberBalanceLike } from '@/utils/payments'

let payload: Payload
let req: PayloadRequest
let seq = 0
const suffix = Date.now().toString(36)
const cashboxes = testCashboxes(() => payload, suffix)
let regionId: number
type Slug =
  'payments' | 'pilgrims' | 'payment-groups' | 'rooms' | 'room-types' | 'regions' | 'users'
const created: { collection: Slug; id: number }[] = []

async function createRoom(
  price: number,
  currency: 'USD' | 'EUR' = 'USD',
  childPrice?: number,
  eurPrice?: number,
) {
  const type = await payload.create({
    collection: 'room-types',
    data: {
      name: `Grup Tipi ${suffix}-${++seq}`,
      capacity: 4,
      pricePerPerson: price,
      currency,
      childPrices: childPrice !== undefined ? [{ minAge: 2, maxAge: 11, price: childPrice }] : [],
      otherPrices: eurPrice !== undefined ? [{ currency: 'EUR', pricePerPerson: eurPrice }] : [],
    },
  })
  created.push({ collection: 'room-types', id: type.id })
  const room = await payload.create({
    collection: 'rooms',
    data: { roomNumber: `G${seq}-${suffix}`, roomType: type.id },
  })
  created.push({ collection: 'rooms', id: room.id })
  return room
}

async function createPilgrim(firstName: string, room?: number, birthDate?: string, phone?: string) {
  const doc = await payload.create({
    collection: 'pilgrims',
    data: {
      firstName,
      lastName: `Grup${suffix}`,
      gender: 'male',
      region: regionId,
      room,
      birthDate,
      phone,
    },
  })
  created.push({ collection: 'pilgrims', id: doc.id })
  return doc
}

async function pay(pilgrim: number, amount: number, currency?: 'USD' | 'EUR') {
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

async function group(name: string, pilgrims: number[], responsible?: number) {
  const doc = await createGroup(req, { name: `${name} ${suffix}`, pilgrims, responsible })
  created.push({ collection: 'payment-groups', id: doc.id })
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

async function accountOf(pilgrimId: number) {
  const [account] = await getAccounts(req, { pilgrim: pilgrimId })
  return account!
}

const yearsAgo = (years: number) => {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}

describe('Ödeme grupları', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const user = await payload.create({
      collection: 'users',
      data: { username: `group-${suffix}`, password: 'test-1234' },
    })
    created.push({ collection: 'users', id: user.id })
    req = await createLocalReq({ user: { ...user, collection: 'users' } }, payload)
    const region = await payload.create({
      collection: 'regions',
      data: { name: `Grup Bölgesi ${suffix}` },
    })
    regionId = region.id
    created.push({ collection: 'regions', id: region.id })
  })

  afterAll(async () => {
    const order: Slug[] = [
      'payments',
      'payment-groups',
      'pilgrims',
      'rooms',
      'room-types',
      'regions',
      'users',
    ]
    for (const collection of order) {
      for (const item of created.filter((c) => c.collection === collection)) {
        await payload.delete({ collection, id: item.id }).catch(() => undefined)
      }
    }
    await cashboxes.cleanup()
  })

  it('hesapları gruplar ve tek kişileri ayrı tutar', () => {
    const member = (id: number, price: number | null, paid: number, group: number | null) =>
      ({
        id,
        fullName: `K${id}`,
        phone: id === 2 ? '05321112233' : null,
        region: null,
        room: price ? { id: id * 10, roomNumber: String(id * 10) } : null,
        price,
        currency: 'USD',
        otherPrices: price ? [{ currency: 'EUR', price: price * 0.9 }] : [],
        paid,
        paymentCount: paid ? 1 : 0,
        lastPaymentAt: null,
        paymentGroup: group ? { id: group, name: 'Aile' } : null,
      }) satisfies MemberBalanceLike
    const accounts = buildAccounts(
      [
        member(1, 1000, 300, 7),
        member(2, 500, 0, 7),
        member(3, null, 0, 7),
        member(4, 800, 0, null),
      ],
      [{ id: 7, name: 'Aile', responsible: null }],
    )
    expect(accounts).toHaveLength(2)
    const family = accounts.find((a) => a.kind === 'group')!
    expect(family).toMatchObject({ price: 1500, paid: 300, balance: 1200, status: 'partial' })
    // Odası olmayan üye diğer para birimi toplamını engellemez.
    expect(family.otherPrices).toEqual([{ currency: 'EUR', price: 1350 }])
    expect(family.contact?.pilgrimId).toBe(2) // sorumlu yok: telefonu olan ilk üye
    expect(family.hasResponsible).toBe(false)
    expect(family.rooms).toEqual(['10', '20'])
    expect(accounts.find((a) => a.kind === 'person')).toMatchObject({
      price: 800,
      status: 'unpaid',
    })

    expect(
      fillReminder('{ad} / {grup} / {kisiler}', {
        name: 'Ali',
        balance: '',
        paid: '',
        price: '',
        room: '',
        group: 'Aile',
        people: '3',
      }),
    ).toBe('Ali / Aile / 3')
  })

  it('iki aile, üç oda: çocuklar kendi ailesinin hesabına yazılır', async () => {
    const roomA = await createRoom(1000, 'USD', 400)
    const roomB = await createRoom(900, 'USD', 400)
    const kids = await createRoom(1000, 'USD', 400)
    const ahmet = await createPilgrim('Ahmet', roomA.id, undefined, '0532 000 00 01')
    const ayse = await createPilgrim('Ayşe', roomA.id)
    const ali = await createPilgrim('Ali', kids.id, yearsAgo(8))
    const mehmet = await createPilgrim('Mehmet', roomB.id)
    const can = await createPilgrim('Can', kids.id, yearsAgo(6))

    const yilmaz = await group('Yılmaz', [ahmet.id, ayse.id, ali.id])
    await group('Demir', [mehmet.id, can.id])
    expect(yilmaz.responsible).toBeTruthy() // telefonu olan Ahmet

    const a = await accountOf(ali.id)
    expect(a).toMatchObject({ kind: 'group', price: 2400, balance: 2400, status: 'unpaid' })
    expect(a.contact?.pilgrimId).toBe(ahmet.id)
    expect((await accountOf(can.id)).price).toBe(1300)

    // Ahmet'in ödemesi ailenin toplamından düşer; çocuğun kendi ödemesi gerekmez.
    await pay(ahmet.id, 2000)
    expect(await accountOf(ali.id)).toMatchObject({ paid: 2000, balance: 400, status: 'partial' })
    // Grubun kalan borcundan fazla alınmaz (kişinin kendi ücreti değil, grubunki sınırdır).
    await expect(pay(ayse.id, 500)).rejects.toThrow()
    await pay(ayse.id, 400)
    expect((await accountOf(ahmet.id)).status).toBe('paid')
  })

  it('grup, tüm üyelerin fiyatı girilmiş para biriminde ödeme yapabilir', async () => {
    const withEur = await createRoom(1000, 'USD', undefined, 900)
    const withoutEur = await createRoom(800)
    const a = await createPilgrim('Euro1', withEur.id)
    const b = await createPilgrim('Euro2', withEur.id)
    const c = await createPilgrim('Dolar', withoutEur.id)
    const d = await createPilgrim('Euro3', withEur.id)

    await group('Euro', [a.id, b.id])
    expect((await accountOf(a.id)).otherPrices).toEqual([{ currency: 'EUR', price: 1800 }])
    // 900 EUR = 1000 USD; grubun toplamından düşer.
    await pay(b.id, 900, 'EUR')
    expect(await accountOf(a.id)).toMatchObject({ paid: 1000, balance: 1000 })

    // Bir üyenin oda tipinde EUR fiyatı yoksa grubun EUR toplamı bilinmez.
    await group('Karışık', [c.id, d.id])
    expect((await accountOf(d.id)).otherPrices).toEqual([])
    expect(await fieldError(pay(d.id, 100, 'EUR'))).toMatch(/EUR ile ödeme alınamaz/)
  })

  it('odası olmayan üye grubun borcu için ödeme yapabilir', async () => {
    const room = await createRoom(700)
    const child = await createPilgrim('Oğul', room.id)
    const father = await createPilgrim('Baba')
    await group('Odasız', [child.id, father.id])
    await pay(father.id, 300)
    expect(await accountOf(child.id)).toMatchObject({ price: 700, paid: 300, balance: 400 })
  })

  it('grupta kimse odada değilken ön ödeme alır, ilk oda atamasında çevirir', async () => {
    const a = await createPilgrim('Eşref')
    const b = await createPilgrim('Esma')
    await group('Ön ödemeli', [a.id, b.id])
    await pay(a.id, 450, 'EUR')
    await pay(b.id, 450, 'EUR')
    expect(await accountOf(a.id)).toMatchObject({
      price: null,
      currency: 'EUR',
      paid: 900,
      status: 'advance',
    })
    expect(await fieldError(pay(b.id, 10, 'USD'))).toMatch(/önceki ön ödemeler EUR/)

    // İlk üye odaya girince grubun tüm ön ödemeleri oda ücretinin para birimine çevrilir.
    const room = await createRoom(1000, 'USD', undefined, 900)
    await payload.update({ collection: 'pilgrims', id: a.id, data: { room: room.id } })
    expect(await accountOf(a.id)).toMatchObject({
      price: 1000,
      currency: 'USD',
      paid: 1000,
      balance: 0,
      status: 'paid',
    })
    await payload.update({ collection: 'pilgrims', id: b.id, data: { room: room.id } })
    expect(await accountOf(a.id)).toMatchObject({ price: 2000, paid: 1000, balance: 1000 })
  })

  it('katılanın ödemesi gruba sayılır, ayrılanın ödemesi onunla gider', async () => {
    const room = await createRoom(1000)
    const a = await createPilgrim('Hasan', room.id)
    const b = await createPilgrim('Hüseyin', room.id)
    await pay(b.id, 600)
    const g = await group('Kardeşler', [a.id])
    expect((await accountOf(a.id)).paid).toBe(0)

    await setGroupMembers(req, { group: g.id, add: [b.id] })
    expect(await accountOf(a.id)).toMatchObject({ price: 2000, paid: 600, balance: 1400 })
    await pay(a.id, 1400)

    // Hüseyin ayrılınca 600 onunla gider; grup 1000 borca karşı 1400 ödemiş olur.
    await setGroupMembers(req, { group: g.id, remove: [b.id] })
    expect(await accountOf(a.id)).toMatchObject({ balance: -400, status: 'overpaid' })
    expect(await accountOf(b.id)).toMatchObject({ kind: 'person', paid: 600, balance: 400 })
  })

  it('farklı para birimli kişiyi gruba eklemez, oda değişikliğinde de korur', async () => {
    const usd = await createRoom(1000, 'USD')
    const eur = await createRoom(900, 'EUR')
    const a = await createPilgrim('Osman', usd.id)
    const b = await createPilgrim('Orhan', eur.id)
    const c = await createPilgrim('Oktay')
    const g = await group('Para', [a.id, c.id])

    await expect(setGroupMembers(req, { group: g.id, add: [b.id] })).rejects.toThrow()
    await expect(
      payload.update({ collection: 'pilgrims', id: c.id, data: { room: eur.id } }),
    ).rejects.toThrow()
    await payload.update({ collection: 'pilgrims', id: c.id, data: { room: usd.id } })
  })

  it('başka gruptaki kişiyle grup kurmaz ve hiçbir şey yazmaz', async () => {
    const room = await createRoom(500)
    const a = await createPilgrim('Selim', room.id)
    const b = await createPilgrim('Sinan', room.id)
    await group('İlk', [a.id])
    const name = `İkinci ${suffix}`
    await expect(createGroup(req, { name, pilgrims: [b.id, a.id] })).rejects.toThrow(
      /başka bir ödeme grubunda/,
    )
    const { totalDocs } = await payload.count({
      collection: 'payment-groups',
      where: { name: { equals: name } },
    })
    expect(totalDocs).toBe(0)
    const fresh = await payload.findByID({ collection: 'pilgrims', id: b.id, depth: 0 })
    expect(fresh.paymentGroup ?? null).toBeNull()
  })

  it('sorumlu ayrılınca boşalır, grup silinince üyeler serbest kalır', async () => {
    const room = await createRoom(500)
    const a = await createPilgrim('Kemal', room.id)
    const b = await createPilgrim('Kerem', room.id)
    const g = await group('Sorumlu', [a.id, b.id], a.id)
    expect(g.responsible).toBeTruthy()

    await setGroupMembers(req, { group: g.id, remove: [a.id] })
    const after = await payload.findByID({ collection: 'payment-groups', id: g.id, depth: 0 })
    expect(after.responsible ?? null).toBeNull()

    await expect(
      payload.update({ collection: 'payment-groups', id: g.id, data: { responsible: a.id } }),
    ).rejects.toThrow()

    await payload.delete({ collection: 'payment-groups', id: g.id })
    const freed = await payload.findByID({ collection: 'pilgrims', id: b.id, depth: 0 })
    expect(freed.paymentGroup ?? null).toBeNull()
  })
})
