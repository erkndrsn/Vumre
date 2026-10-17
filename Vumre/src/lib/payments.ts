import type { Endpoint, Payload, PayloadRequest, Where } from 'payload'

import {
  buildAccounts,
  memberStatus,
  roundMoney,
  type AccountBalance,
  type BalanceStatus,
  type CurrencyPrice,
} from '../utils/payments'
import { relationId } from './rooms'
import { requireAdmin } from './access'

type Id = number | string

/** Bir umrecinin oda ücretine göre borç / ödeme özeti. */
export interface PilgrimBalance {
  id: Id
  fullName: string
  tcNo: string | null
  passportNo: string | null
  phone: string | null
  region: { id: Id; name: string } | null
  room: { id: Id; roomNumber: string } | null
  paymentGroup: { id: Id; name: string } | null
  /** Oda ücreti (borç); odaya atanmamışsa null. */
  price: number | null
  currency: string | null
  /** Oda ücretinin diğer para birimlerindeki karşılıkları. */
  otherPrices: CurrencyPrice[]
  /** Ödemelerin borçtan düşülen (ana para birimindeki) toplamı. */
  paid: number
  /** Kalan borç; eksi ise fazla ödeme (iade). */
  balance: number
  paymentCount: number
  lastPaymentAt: string | null
  status: BalanceStatus
  /** Programı iptal edip arşive taşınmış. */
  archived: boolean
}

/**
 * Ödemenin borçtan düşülen tutarı ve para birimi. Bu alanlardan önce kaydedilmiş ödemelerde
 * ödeme zaten borcun para birimindeydi.
 */
export function debtPart(p: {
  amount?: number | null
  currency?: string | null
  debtAmount?: number | null
  debtCurrency?: string | null
}) {
  return { amount: p.debtAmount ?? p.amount ?? 0, currency: p.debtCurrency ?? p.currency ?? null }
}

/**
 * Borçtan düşülen tutarı olmayan eski ödemelere, ödenen tutarı yazar. Hook'lar çalıştırılmaz;
 * ödeme o zamanlar borcun para birimindeydi.
 */
export async function backfillPaymentDebt(payload: Payload) {
  const { docs } = await payload.find({
    collection: 'payments',
    where: { debtAmount: { exists: false } },
    select: { amount: true, currency: true },
    pagination: false,
    depth: 0,
  })
  for (const p of docs) {
    await payload.db.updateOne({
      collection: 'payments',
      id: p.id,
      data: { debtAmount: p.amount, debtCurrency: p.currency },
    })
  }
}

/** Umrecinin ödemelerinin borçtan düşülen toplamı. `excludePaymentId` güncellenen ödemenin kendisini saymamak içindir. */
export async function paidTotal(req: PayloadRequest, pilgrimId: Id, excludePaymentId?: Id) {
  const { docs } = await req.payload.find({
    collection: 'payments',
    where: {
      pilgrim: { equals: pilgrimId },
      ...(excludePaymentId !== undefined ? { id: { not_equals: excludePaymentId } } : {}),
    },
    select: { amount: true, debtAmount: true },
    pagination: false,
    depth: 0,
    req,
  })
  return roundMoney(docs.reduce((sum, p) => sum + debtPart(p).amount, 0))
}

/**
 * Kişilerin (odası belli olmadan alınmış) ön ödemelerinin para birimi; ödemesi yoksa null.
 * Ön ödemeler tek para biriminde tutulur ki odaya atanınca tek oranla çevrilebilsin.
 */
export async function advanceCurrency(
  req: PayloadRequest,
  pilgrimIds: Id[],
  excludePaymentId?: Id,
) {
  if (!pilgrimIds.length) return null
  const { docs } = await req.payload.find({
    collection: 'payments',
    where: {
      pilgrim: { in: pilgrimIds },
      ...(excludePaymentId !== undefined ? { id: { not_equals: excludePaymentId } } : {}),
    },
    select: { currency: true, debtCurrency: true },
    limit: 1,
    depth: 0,
    req,
  })
  return docs[0] ? debtPart(docs[0]).currency : null
}

/**
 * Odası belli olmadan alınmış ön ödemeleri, kişi (veya grubun ilk üyesi) odaya atanırken oda
 * ücretinin para birimine çevirir. Oran oda tipinin kişi başı fiyatlarından gelir; oda tipinde
 * ön ödemenin para birimi yoksa hata mesajı döner. Hook'lar çalıştırılmaz.
 */
export async function convertAdvancePayments(
  req: PayloadRequest,
  pilgrimIds: Id[],
  roomType: {
    currency: string
    pricePerPerson: number
    otherPrices?: { currency: string; pricePerPerson: number }[] | null
  },
): Promise<string | null> {
  if (!pilgrimIds.length) return null
  const { docs } = await req.payload.find({
    collection: 'payments',
    where: {
      pilgrim: { in: pilgrimIds },
      debtCurrency: { not_equals: roomType.currency },
    },
    select: { amount: true, currency: true, debtAmount: true, debtCurrency: true },
    pagination: false,
    depth: 0,
    req,
  })
  for (const p of docs) {
    const from = debtPart(p)
    const rate = (roomType.otherPrices ?? []).find((o) => o.currency === from.currency)
    if (!rate || !(rate.pricePerPerson > 0) || !from.currency) {
      return (
        `${from.currency} cinsinden ön ödeme var; oda tipinde ${from.currency} fiyatı olmadığı ` +
        `için ${roomType.currency} ücretli odaya çevrilemez.`
      )
    }
  }
  for (const p of docs) {
    const from = debtPart(p)
    const rate = roomType.otherPrices!.find((o) => o.currency === from.currency)!
    await req.payload.db.updateOne({
      collection: 'payments',
      id: p.id,
      data: {
        debtAmount: roundMoney((from.amount * roomType.pricePerPerson) / rate.pricePerPerson),
        debtCurrency: roomType.currency,
      },
      req,
    })
  }
  return null
}

/** Umrecinin borcuna verilen para biriminden farklı yazılmış ödemesi var mı? */
export async function hasPaymentsInOtherCurrency(
  req: PayloadRequest,
  pilgrimId: Id,
  currency: string,
) {
  const { totalDocs } = await req.payload.count({
    collection: 'payments',
    where: { pilgrim: { equals: pilgrimId }, debtCurrency: { not_equals: currency } },
    req,
  })
  return totalDocs > 0
}

/**
 * Tüm umrecilerin (veya `pilgrimId` verilirse yalnız onun) borç özetini sabit sayıda
 * sorguyla hesaplar. Borç, odaya atanırken umreciye yazılan oda ücretidir.
 */
export async function getBalances(req: PayloadRequest, pilgrimId?: Id): Promise<PilgrimBalance[]> {
  const pilgrimWhere: Where | undefined =
    pilgrimId !== undefined ? { id: { equals: pilgrimId } } : undefined
  const paymentWhere: Where | undefined =
    pilgrimId !== undefined ? { pilgrim: { equals: pilgrimId } } : undefined

  const [pilgrims, payments, regions, rooms, groups] = await Promise.all([
    req.payload.find({
      collection: 'pilgrims',
      where: pilgrimWhere,
      select: {
        fullName: true,
        tcNo: true,
        passportNo: true,
        phone: true,
        region: true,
        room: true,
        paymentGroup: true,
        roomPrice: true,
        roomCurrency: true,
        roomOtherPrices: true,
        archived: true,
      },
      sort: 'fullName',
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
    req.payload.find({
      collection: 'payments',
      where: paymentWhere,
      select: {
        pilgrim: true,
        amount: true,
        currency: true,
        debtAmount: true,
        debtCurrency: true,
        paidAt: true,
      },
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
    req.payload.find({
      collection: 'regions',
      select: { name: true },
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
    req.payload.find({
      collection: 'rooms',
      select: { roomNumber: true },
      pagination: false,
      depth: 0,
      context: { skipOccupancy: true },
      overrideAccess: false,
      req,
    }),
    req.payload.find({
      collection: 'payment-groups',
      select: { name: true },
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
  ])

  const regionById = new Map(regions.docs.map((r) => [String(r.id), r]))
  const roomById = new Map(rooms.docs.map((r) => [String(r.id), r]))
  const groupById = new Map(groups.docs.map((g) => [String(g.id), g]))

  const paidBy = new Map<
    string,
    { total: number; count: number; currency: string; last: string | null }
  >()
  for (const p of payments.docs) {
    const key = String(relationId(p.pilgrim))
    const debt = debtPart(p)
    const entry = paidBy.get(key) ?? {
      total: 0,
      count: 0,
      currency: debt.currency ?? '',
      last: null,
    }
    entry.total += debt.amount
    entry.count++
    if (p.paidAt && (!entry.last || p.paidAt > entry.last)) entry.last = p.paidAt
    paidBy.set(key, entry)
  }

  // Arşivdekiler (programı iptal edenler) yalnızca ödemeleri varsa, iade için listelenir.
  const listed =
    pilgrimId !== undefined
      ? pilgrims.docs
      : pilgrims.docs.filter((p) => !p.archived || paidBy.has(String(p.id)))

  return listed.map((p) => {
    const regionId = relationId(p.region)
    const region = regionId !== null ? regionById.get(String(regionId)) : undefined
    const roomId = relationId(p.room)
    const room = roomId !== null ? roomById.get(String(roomId)) : undefined
    const groupId = relationId(p.paymentGroup)
    const group = groupId !== null ? groupById.get(String(groupId)) : undefined
    const paid = paidBy.get(String(p.id))
    const paidAmount = roundMoney(paid?.total ?? 0)
    const price = p.roomPrice ?? null
    return {
      id: p.id,
      fullName: p.fullName ?? '',
      tcNo: p.tcNo ?? null,
      passportNo: p.passportNo ?? null,
      phone: p.phone ?? null,
      region: region ? { id: region.id, name: region.name } : null,
      room: room ? { id: room.id, roomNumber: room.roomNumber } : null,
      paymentGroup: group ? { id: group.id, name: group.name } : null,
      price,
      // Odadan çıkarılmış ama ödemesi olan kişide para birimi ödemeden gelir.
      currency: p.roomCurrency || paid?.currency || null,
      otherPrices:
        price != null
          ? (p.roomOtherPrices ?? []).map(({ currency, price }) => ({ currency, price }))
          : [],
      paid: paidAmount,
      balance: roundMoney((price ?? 0) - paidAmount),
      paymentCount: paid?.count ?? 0,
      lastPaymentAt: paid?.last ?? null,
      status: memberStatus(price, paidAmount, p.archived === true),
      archived: p.archived === true,
    }
  })
}

/** `?pilgrim=<id>` verilirse yalnız o umrecinin özeti döner. */
export const balancesEndpoint: Endpoint = {
  path: '/balances',
  method: 'get',
  handler: async (req) => {
    requireAdmin(req)
    const param = req.searchParams.get('pilgrim')
    const pilgrim = param ? (/^\d+$/.test(param) ? Number(param) : param) : undefined
    return Response.json({ docs: await getBalances(req, pilgrim) })
  },
}

/**
 * Ödeme hesapları: her ödeme grubu tek hesap, grubu olmayan herkes kendi hesabı.
 * `pilgrimId` verilirse yalnız o kişinin hesabı (grubu varsa grubun tamamı) döner.
 */
export async function getAccounts(
  req: PayloadRequest,
  filter: { pilgrim?: Id; group?: Id } = {},
): Promise<AccountBalance<PilgrimBalance>[]> {
  const [balances, groups] = await Promise.all([
    getBalances(req),
    req.payload.find({
      collection: 'payment-groups',
      select: { name: true, responsible: true, note: true },
      pagination: false,
      depth: 0,
      overrideAccess: false,
      req,
    }),
  ])
  const accounts = buildAccounts(
    balances,
    groups.docs.map((g) => ({
      id: g.id,
      name: g.name,
      responsible: relationId(g.responsible),
      note: g.note ?? null,
    })),
  )
  if (filter.group !== undefined) {
    return accounts.filter((a) => String(a.groupId) === String(filter.group))
  }
  if (filter.pilgrim !== undefined) {
    return accounts.filter((a) => a.members.some((m) => String(m.id) === String(filter.pilgrim)))
  }
  return accounts
}

const idParam = (value: string | null) =>
  value ? (/^\d+$/.test(value) ? Number(value) : value) : undefined

/** `?pilgrim=<id>` veya `?group=<id>` ile tek hesap istenebilir. */
export const accountsEndpoint: Endpoint = {
  path: '/accounts',
  method: 'get',
  handler: async (req) => {
    requireAdmin(req)
    const docs = await getAccounts(req, {
      pilgrim: idParam(req.searchParams.get('pilgrim')),
      group: idParam(req.searchParams.get('group')),
    })
    return Response.json({ docs })
  },
}
