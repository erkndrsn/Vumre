import {
  addDataAndFileToRequest,
  APIError,
  commitTransaction,
  initTransaction,
  killTransaction,
  type Endpoint,
  type PayloadRequest,
} from 'payload'

import { roundMoney, sumOtherPrices } from '../utils/payments'
import { debtPart } from './payments'
import { relationId } from './rooms'
import { requireAdmin } from './access'

type Id = number | string

export const MAX_GROUP_MEMBERS = 100

const badRequest = (message: string) => new APIError(message, 400, null, true)

/** Grubun üyeleri; `excludePilgrimId` güncellenen kişinin kendisini saymamak içindir. */
export async function groupMembers(req: PayloadRequest, groupId: Id, excludePilgrimId?: Id) {
  const { docs } = await req.payload.find({
    collection: 'pilgrims',
    where: {
      paymentGroup: { equals: groupId },
      ...(excludePilgrimId !== undefined ? { id: { not_equals: excludePilgrimId } } : {}),
    },
    select: {
      fullName: true,
      phone: true,
      roomPrice: true,
      roomCurrency: true,
      roomOtherPrices: true,
    },
    pagination: false,
    depth: 0,
    req,
  })
  return docs
}

/** Kişilerin ödemelerinin borca yazıldığı para birimleri. */
async function paymentCurrencies(req: PayloadRequest, pilgrimIds: Id[]) {
  if (!pilgrimIds.length) return new Set<string>()
  const { docs } = await req.payload.find({
    collection: 'payments',
    where: { pilgrim: { in: pilgrimIds } },
    select: { currency: true, debtCurrency: true },
    pagination: false,
    depth: 0,
    req,
  })
  return new Set(docs.map((p) => debtPart(p).currency).filter((c): c is string => !!c))
}

/**
 * Grubun para birimi: üyelerin oda para birimi, odası olmayan üyelerde ödemelerinin
 * para birimi. Grupta para birimi yoksa (kimse odada değil, ödeme de yok) null.
 */
export async function groupCurrency(req: PayloadRequest, groupId: Id, excludePilgrimId?: Id) {
  const members = await groupMembers(req, groupId, excludePilgrimId)
  const fromRooms = members.map((m) => m.roomCurrency).find(Boolean)
  if (fromRooms) return fromRooms
  const [fromPayments] = await paymentCurrencies(
    req,
    members.map((m) => m.id),
  )
  return fromPayments ?? null
}

/** Kişinin para birimi: odasınınki, odası yoksa ödemelerininki. */
export async function pilgrimCurrency(
  req: PayloadRequest,
  pilgrimId: Id | undefined,
  roomCurrency: string | null | undefined,
) {
  if (roomCurrency) return roomCurrency
  if (pilgrimId === undefined) return null
  const [fromPayments] = await paymentCurrencies(req, [pilgrimId])
  return fromPayments ?? null
}

/**
 * Grubun borç özeti: üyelerin oda ücretleri toplamı (diğer para birimlerindeki karşılıklarıyla)
 * ve üyelerin ödemelerinin borçtan düşülen toplamı.
 * `excludePaymentId` düzenlenen ödemenin eski tutarını saymamak içindir.
 */
export async function groupDebt(req: PayloadRequest, groupId: Id, excludePaymentId?: Id) {
  const members = await groupMembers(req, groupId)
  const ids = members.map((m) => m.id)
  const { docs: payments } = ids.length
    ? await req.payload.find({
        collection: 'payments',
        where: {
          pilgrim: { in: ids },
          ...(excludePaymentId !== undefined ? { id: { not_equals: excludePaymentId } } : {}),
        },
        select: { amount: true, debtAmount: true },
        pagination: false,
        depth: 0,
        req,
      })
    : { docs: [] }
  return {
    price: roundMoney(members.reduce((sum, m) => sum + (m.roomPrice ?? 0), 0)),
    otherPrices: sumOtherPrices(
      members.map((m) => ({ price: m.roomPrice ?? null, otherPrices: m.roomOtherPrices })),
    ),
    paid: roundMoney(payments.reduce((sum, p) => sum + debtPart(p).amount, 0)),
    currency: members.map((m) => m.roomCurrency).find(Boolean) ?? null,
  }
}

function uniqueIds(value: unknown): Id[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => relationId(id)))].filter((id): id is Id => id !== null)
}

/** Eklenecek kişiler başka bir grupta olmamalı; aynı gruptakiler sessizce atlanır. */
async function pilgrimsToAdd(req: PayloadRequest, ids: Id[], groupId?: Id) {
  if (!ids.length) return []
  const { docs } = await req.payload.find({
    collection: 'pilgrims',
    where: { id: { in: ids } },
    select: { fullName: true, phone: true, paymentGroup: true, archived: true },
    pagination: false,
    depth: 1,
    req,
  })
  if (docs.length !== ids.length) {
    throw badRequest('Seçilen umrecilerden bazıları bulunamadı. Sayfayı yenileyin.')
  }
  const archived = docs.filter((p) => p.archived)
  if (archived.length) {
    throw badRequest(
      `Arşivdeki umreciler gruba eklenemez: ${archived.map((p) => p.fullName).join(', ')}.`,
    )
  }
  const elsewhere = docs.filter((p) => {
    const current = relationId(p.paymentGroup)
    return current !== null && String(current) !== String(groupId)
  })
  if (elsewhere.length) {
    const names = elsewhere
      .slice(0, 5)
      .map((p) => {
        const group = typeof p.paymentGroup === 'object' ? p.paymentGroup?.name : null
        return group ? `${p.fullName} (${group})` : p.fullName
      })
      .join(', ')
    throw badRequest(
      `Şu kişiler zaten başka bir ödeme grubunda: ${names}${elsewhere.length > 5 ? '…' : ''}. Önce o gruptan çıkarın.`,
    )
  }
  return docs.filter((p) => relationId(p.paymentGroup) === null)
}

async function inTransaction<T>(req: PayloadRequest, work: () => Promise<T>): Promise<T> {
  const ownsTransaction = await initTransaction(req)
  try {
    const result = await work()
    if (ownsTransaction) await commitTransaction(req)
    return result
  } catch (error) {
    if (ownsTransaction) await killTransaction(req)
    throw error
  }
}

async function addMembers(req: PayloadRequest, groupId: Id, pilgrims: { id: Id }[]) {
  for (const p of pilgrims) {
    await req.payload.update({
      collection: 'pilgrims',
      id: p.id,
      data: { paymentGroup: groupId as number },
      depth: 0,
      overrideAccess: false,
      req,
    })
  }
}

/**
 * Grubu üyeleriyle birlikte tek seferde oluşturur. Sorumlu verilmezse telefonu olan
 * ilk üye seçilir. Para birimi farklı üye varsa Pilgrims hook'u hata verir ve hiçbir şey yazılmaz.
 */
export async function createGroup(
  req: PayloadRequest,
  input: { name?: unknown; pilgrims?: unknown; responsible?: unknown; note?: unknown },
) {
  const name = String(input.name ?? '').trim()
  if (!name) throw badRequest('Grup adı girin.')
  const ids = uniqueIds(input.pilgrims)
  if (!ids.length) throw badRequest('Gruba eklenecek umrecileri seçin.')
  if (ids.length > MAX_GROUP_MEMBERS) {
    throw badRequest(`Bir grupta en fazla ${MAX_GROUP_MEMBERS} kişi olabilir.`)
  }
  const responsibleId = relationId(input.responsible)
  if (responsibleId !== null && !ids.some((id) => String(id) === String(responsibleId))) {
    throw badRequest('Sorumlu kişi grubun üyelerinden biri olmalıdır.')
  }

  const pilgrims = await pilgrimsToAdd(req, ids)
  const responsible = responsibleId ?? pilgrims.find((p) => p.phone)?.id ?? pilgrims[0]?.id ?? null

  return inTransaction(req, async () => {
    const group = await req.payload.create({
      collection: 'payment-groups',
      data: { name, note: input.note ? String(input.note) : undefined },
      overrideAccess: false,
      req,
    })
    await addMembers(req, group.id, pilgrims)
    return req.payload.update({
      collection: 'payment-groups',
      id: group.id,
      data: { responsible: responsible as number | null },
      overrideAccess: false,
      req,
    })
  })
}

/** Gruba üye ekler (`add`) veya gruptan çıkarır (`remove`). */
export async function setGroupMembers(
  req: PayloadRequest,
  input: { group?: unknown; add?: unknown; remove?: unknown },
) {
  const groupId = relationId(input.group)
  if (groupId === null) throw badRequest('Ödeme grubunu seçin.')
  const group = await req.payload
    .findByID({ collection: 'payment-groups', id: groupId, depth: 0, req })
    .catch(() => null)
  if (!group) throw badRequest('Ödeme grubu bulunamadı.')

  const addIds = uniqueIds(input.add)
  const removeIds = uniqueIds(input.remove)
  if (!addIds.length && !removeIds.length)
    throw badRequest('Eklenecek veya çıkarılacak kişi seçin.')

  const toAdd = await pilgrimsToAdd(req, addIds, group.id)
  const current = await groupMembers(req, group.id)
  if (current.length + toAdd.length > MAX_GROUP_MEMBERS) {
    throw badRequest(`Bir grupta en fazla ${MAX_GROUP_MEMBERS} kişi olabilir.`)
  }
  const toRemove = current.filter((m) => removeIds.some((id) => String(id) === String(m.id)))

  await inTransaction(req, async () => {
    for (const m of toRemove) {
      await req.payload.update({
        collection: 'pilgrims',
        id: m.id,
        data: { paymentGroup: null },
        depth: 0,
        overrideAccess: false,
        req,
      })
    }
    await addMembers(req, group.id, toAdd)
  })
  return { added: toAdd.length, removed: toRemove.length }
}

/** Gövde: `{ name, pilgrims: id[], responsible?, note? }` */
export const createGroupEndpoint: Endpoint = {
  path: '/create',
  method: 'post',
  handler: async (req) => {
    requireAdmin(req)
    await addDataAndFileToRequest(req)
    return Response.json({ doc: await createGroup(req, req.data ?? {}) })
  },
}

/** Gövde: `{ group, add?: id[], remove?: id[] }` */
export const groupMembersEndpoint: Endpoint = {
  path: '/members',
  method: 'post',
  handler: async (req) => {
    requireAdmin(req)
    await addDataAndFileToRequest(req)
    return Response.json(await setGroupMembers(req, req.data ?? {}))
  },
}
