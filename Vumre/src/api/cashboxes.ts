import type { Cashbox, CashboxBalance, CashboxLedger, CashTransfer } from '@/types/payload'
import { create, find, remove, serializeQuery, update } from './collections'
import { request } from './client'

export async function listCashboxes() {
  const res = await find<Cashbox>('cashboxes', { sort: 'name', limit: 0, depth: 0 })
  return res.docs
}

/** Her kasanın bakiyesi (tahsilat + gelen virman − ödeme − giden virman). */
export async function getCashboxBalances() {
  const res = await request<{ docs: CashboxBalance[] }>('/cashboxes/balances')
  return res.docs
}

/** Kasanın tarih sıralı hareket dökümü; `from`/`to` YYYY-MM-DD (dahil). */
export function getCashboxLedger(cashbox: number, range: { from?: string; to?: string } = {}) {
  const query = serializeQuery({
    cashbox,
    from: range.from || undefined,
    to: range.to || undefined,
  })
  return request<{ cashbox: CashboxBalance; ledger: CashboxLedger }>(`/cashboxes/ledger${query}`)
}

export function createCashbox(
  data: Pick<Cashbox, 'name' | 'currency' | 'kind'> & Partial<Pick<Cashbox, 'note' | 'active'>>,
) {
  return create<Cashbox>('cashboxes', data)
}

export function updateCashbox(
  id: number,
  data: Partial<Pick<Cashbox, 'name' | 'currency' | 'kind' | 'note' | 'active'>>,
) {
  return update<Cashbox>('cashboxes', id, data)
}

export function deleteCashbox(id: number) {
  return remove<Cashbox>('cashboxes', id)
}

export async function listTransfers(limit = 0) {
  const res = await find<CashTransfer>('cash-transfers', {
    sort: '-transferredAt',
    limit,
    depth: 1,
  })
  return res.docs
}

export function createTransfer(
  data: Pick<CashTransfer, 'from' | 'to' | 'amount' | 'transferredAt'> &
    Partial<Pick<CashTransfer, 'toAmount' | 'note'>>,
) {
  return create<CashTransfer>('cash-transfers', data)
}

export function deleteTransfer(id: number) {
  return remove<CashTransfer>('cash-transfers', id)
}
