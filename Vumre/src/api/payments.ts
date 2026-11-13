import type { AccountBalance, Payment, PaymentReceipt, PilgrimBalance } from '@/types/payload'
import { create, find, remove, update } from './collections'
import { request } from './client'

/** Tüm umrecilerin (veya yalnız `pilgrim`in) oda ücretine göre borç özeti. */
export async function getBalances(pilgrim?: number) {
  const query = pilgrim ? `?pilgrim=${pilgrim}` : ''
  const res = await request<{ docs: PilgrimBalance[] }>(`/payments/balances${query}`)
  return res.docs
}

/** Ödeme hesapları (grup veya tek kişi); `pilgrim`/`group` verilirse yalnız o hesap. */
export async function getAccounts(filter: { pilgrim?: number; group?: number } = {}) {
  const query = filter.group
    ? `?group=${filter.group}`
    : filter.pilgrim
      ? `?pilgrim=${filter.pilgrim}`
      : ''
  const res = await request<{ docs: AccountBalance[] }>(`/payments/accounts${query}`)
  return res.docs
}

/** Kişilerin (bir grubun tüm üyelerinin) ödemeleri; boş liste verilirse son ödemeler. */
export async function listPayments(pilgrims?: number | number[], limit = 0) {
  const ids = pilgrims === undefined ? [] : Array.isArray(pilgrims) ? pilgrims : [pilgrims]
  const res = await find<Payment>('payments', {
    where: ids.length ? { pilgrim: { in: ids.join(',') } } : undefined,
    sort: '-paidAt',
    limit,
    depth: 1,
  })
  return res.docs
}

export function createPayment(
  data: Pick<Payment, 'pilgrim' | 'amount' | 'paidAt'> & { cashbox: number } & Partial<
      Pick<Payment, 'currency' | 'receiptNo' | 'note'>
    >,
) {
  return create<Payment>('payments', data)
}

export function updatePayment(
  id: number,
  data: Partial<
    Pick<Payment, 'pilgrim' | 'amount' | 'paidAt' | 'currency' | 'receiptNo' | 'note'>
  > & {
    cashbox?: number
  },
) {
  return update<Payment>('payments', id, data)
}

export function deletePayment(id: number) {
  return remove<Payment>('payments', id)
}

/** Dekontu Payload'un beklediği multipart biçimde (`file` + `_payload`) tahsilata ekler. */
export function uploadReceipt(payment: number, file: File) {
  const body = new FormData()
  body.append('file', file)
  body.append('_payload', JSON.stringify({ payment }))
  return create<PaymentReceipt>('payment-receipts', body)
}

export function removeReceipt(id: number) {
  return remove<PaymentReceipt>('payment-receipts', id)
}
