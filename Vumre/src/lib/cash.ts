import { APIError, type Endpoint, type Payload, type PayloadRequest } from 'payload'

import {
  buildLedger,
  DEFAULT_CASHBOX_PREFIX,
  summarizeCashboxes,
  type CashboxBalance,
  type CashboxKind,
  type CashboxLedger,
  type LedgerMovement,
} from '../utils/cash'
import { relationId } from './rooms'
import { requireAdmin } from './access'

type Id = number | string

/** Tüm kasaların bakiyeleri (tahsilat + gelen virman − gider − giden virman). */
export async function getCashboxBalances(req: PayloadRequest): Promise<CashboxBalance[]> {
  const common = { pagination: false, depth: 0, overrideAccess: false, req } as const
  const [cashboxes, payments, expenses, transfers] = await Promise.all([
    req.payload.find({
      collection: 'cashboxes',
      select: { name: true, currency: true, kind: true, active: true },
      ...common,
    }),
    req.payload.find({
      collection: 'payments',
      select: { cashbox: true, amount: true },
      ...common,
    }),
    req.payload.find({
      collection: 'expenses',
      select: { cashbox: true, amount: true },
      ...common,
    }),
    req.payload.find({
      collection: 'cash-transfers',
      select: { from: true, to: true, amount: true, toAmount: true },
      ...common,
    }),
  ])
  return summarizeCashboxes(cashboxes.docs, payments.docs, expenses.docs, transfers.docs)
}

/** Bir kasanın tarih sıralı hareket dökümü ve yürüyen bakiyesi. */
export async function getCashboxLedger(
  req: PayloadRequest,
  cashboxId: Id,
  range: { from?: string | null; to?: string | null } = {},
): Promise<{ cashbox: CashboxBalance; ledger: CashboxLedger }> {
  const common = { pagination: false, depth: 1, overrideAccess: false, req } as const
  const [cashbox, payments, expenses, transfers] = await Promise.all([
    req.payload
      .findByID({ collection: 'cashboxes', id: cashboxId, depth: 0, overrideAccess: false, req })
      .catch(() => null),
    req.payload.find({
      collection: 'payments',
      where: { cashbox: { equals: cashboxId } },
      select: { pilgrim: true, amount: true, paidAt: true, receiptNo: true, createdAt: true },
      populate: { pilgrims: { fullName: true } },
      ...common,
    }),
    req.payload.find({
      collection: 'expenses',
      where: { cashbox: { equals: cashboxId } },
      select: { description: true, payee: true, amount: true, paidAt: true, createdAt: true },
      ...common,
      depth: 0,
    }),
    req.payload.find({
      collection: 'cash-transfers',
      where: { or: [{ from: { equals: cashboxId } }, { to: { equals: cashboxId } }] },
      select: {
        from: true,
        to: true,
        amount: true,
        toAmount: true,
        transferredAt: true,
        note: true,
        createdAt: true,
      },
      populate: { cashboxes: { name: true } },
      ...common,
    }),
  ])
  if (!cashbox) throw new APIError('Kasa bulunamadı.', 404, null, true)

  const nameOf = (value: unknown) =>
    value && typeof value === 'object' ? ((value as { name?: string }).name ?? '') : ''
  const withNote = (text: string, note?: string | null) => (note ? `${text} — ${note}` : text)

  const movements: LedgerMovement[] = [
    ...payments.docs.map((p) => ({
      type: 'payment' as const,
      id: p.id,
      date: p.paidAt,
      createdAt: p.createdAt,
      description:
        (typeof p.pilgrim === 'object' && p.pilgrim ? (p.pilgrim.fullName ?? '') : '') +
        (p.receiptNo ? ` (makbuz ${p.receiptNo})` : ''),
      amount: p.amount,
    })),
    ...expenses.docs.map((e) => ({
      type: 'expense' as const,
      id: e.id,
      date: e.paidAt,
      createdAt: e.createdAt,
      description: e.payee ? `${e.description} — ${e.payee}` : e.description,
      amount: e.amount,
    })),
    ...transfers.docs.flatMap((t) => {
      const out: LedgerMovement[] = []
      // Aynı kasaya virman yapılamaz; yine de iki yön ayrı ayrı değerlendirilir.
      if (String(relationId(t.from)) === String(cashboxId)) {
        out.push({
          type: 'transfer-out',
          id: t.id,
          date: t.transferredAt,
          createdAt: t.createdAt,
          description: withNote(`→ ${nameOf(t.to)}`, t.note),
          amount: t.amount,
        })
      }
      if (String(relationId(t.to)) === String(cashboxId)) {
        out.push({
          type: 'transfer-in',
          id: t.id,
          date: t.transferredAt,
          createdAt: t.createdAt,
          description: withNote(`← ${nameOf(t.from)}`, t.note),
          amount: t.toAmount ?? t.amount,
        })
      }
      return out
    }),
  ]

  const [balance] = summarizeCashboxes(
    [cashbox],
    payments.docs.map((p) => ({ cashbox: cashboxId, amount: p.amount })),
    expenses.docs.map((e) => ({ cashbox: cashboxId, amount: e.amount })),
    transfers.docs.map((t) => ({
      from: relationId(t.from),
      to: relationId(t.to),
      amount: t.amount,
      toAmount: t.toAmount,
    })),
  )
  return { cashbox: balance!, ledger: buildLedger(movements, range) }
}

/** Kasaya bağlı tahsilat, gider veya virman var mı? */
export async function hasCashboxMovements(req: PayloadRequest, cashboxId: Id) {
  const counts = await Promise.all([
    req.payload.count({ collection: 'payments', where: { cashbox: { equals: cashboxId } }, req }),
    req.payload.count({ collection: 'expenses', where: { cashbox: { equals: cashboxId } }, req }),
    req.payload.count({
      collection: 'cash-transfers',
      where: { or: [{ from: { equals: cashboxId } }, { to: { equals: cashboxId } }] },
      req,
    }),
  ])
  return counts.some((c) => c.totalDocs > 0)
}

/** Hareket girilecek kasayı yükler; yoksa veya (yeni harekette) pasifse hata mesajı döner. */
export async function loadCashbox(req: PayloadRequest, value: unknown, requireActive: boolean) {
  const id = relationId(value)
  if (id === null) return { error: 'Kasa seçin.' } as const
  const cashbox = await req.payload
    .findByID({ collection: 'cashboxes', id, depth: 0, req })
    .catch(() => null)
  if (!cashbox) return { error: 'Kasa bulunamadı.' } as const
  if (requireActive && cashbox.active === false) {
    return { error: `${cashbox.name} pasif; bu kasaya hareket girilemez.` } as const
  }
  return { cashbox } as const
}

/**
 * Kasası olmayan (kasa sistemi öncesi) tahsilat ve giderleri, para birimi + ödeme şekline göre
 * "Nakit USD", "Banka SAR" gibi kasalara bağlar; kasa yoksa açar. Hook'lar çalıştırılmaz.
 */
export async function backfillCashboxes(payload: Payload) {
  const cache = new Map<string, Id>()
  const cashboxFor = async (currency: string, kind: CashboxKind) => {
    const name = `${DEFAULT_CASHBOX_PREFIX[kind] ?? DEFAULT_CASHBOX_PREFIX.cash} ${currency}`
    const cached = cache.get(name)
    if (cached !== undefined) return cached
    const { docs } = await payload.find({
      collection: 'cashboxes',
      where: { name: { equals: name } },
      limit: 1,
      depth: 0,
    })
    const existing = docs[0]
    const id = existing
      ? existing.id
      : (
          await payload.create({
            collection: 'cashboxes',
            data: { name, currency: currency as 'USD', kind, active: true },
          })
        ).id
    cache.set(name, id)
    return id
  }

  const { docs: payments } = await payload.find({
    collection: 'payments',
    where: { cashbox: { exists: false } },
    select: { currency: true, debtCurrency: true, method: true },
    pagination: false,
    depth: 0,
  })
  for (const p of payments) {
    const currency = p.currency ?? p.debtCurrency
    if (!currency) continue
    const cashbox = await cashboxFor(currency, p.method ?? 'cash')
    await payload.db.updateOne({ collection: 'payments', id: p.id, data: { cashbox } })
  }

  const { docs: expenses } = await payload.find({
    collection: 'expenses',
    where: { cashbox: { exists: false } },
    select: { currency: true, method: true },
    pagination: false,
    depth: 0,
  })
  for (const e of expenses) {
    if (!e.currency) continue
    const cashbox = await cashboxFor(e.currency, e.method ?? 'cash')
    await payload.db.updateOne({ collection: 'expenses', id: e.id, data: { cashbox } })
  }
}

export const cashboxBalancesEndpoint: Endpoint = {
  path: '/balances',
  method: 'get',
  handler: async (req) => {
    requireAdmin(req)
    return Response.json({ docs: await getCashboxBalances(req) })
  },
}

/** `GET /api/cashboxes/ledger?cashbox=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD` */
export const cashboxLedgerEndpoint: Endpoint = {
  path: '/ledger',
  method: 'get',
  handler: async (req) => {
    requireAdmin(req)
    const query = req.query as Record<string, unknown>
    const cashbox = query.cashbox ? String(query.cashbox) : ''
    if (!cashbox) throw new APIError('Kasa seçin.', 400, null, true)
    const day = (v: unknown) =>
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
    return Response.json(
      await getCashboxLedger(req, cashbox, { from: day(query.from), to: day(query.to) }),
    )
  },
}
