import type { PaymentGroup } from '@/types/payload'
import { find, remove, update } from './collections'
import { request } from './client'

export async function listGroups() {
  const res = await find<PaymentGroup>('payment-groups', { limit: 0, sort: 'name', depth: 0 })
  return res.docs
}

/** Grubu üyeleriyle tek seferde oluşturur; sorumlu verilmezse telefonu olan ilk üye seçilir. */
export async function createGroup(data: {
  name: string
  pilgrims: number[]
  responsible?: number | null
  note?: string | null
}) {
  const res = await request<{ doc: PaymentGroup }>('/payment-groups/create', {
    method: 'POST',
    body: data,
  })
  return res.doc
}

export function setGroupMembers(group: number, change: { add?: number[]; remove?: number[] }) {
  return request<{ added: number; removed: number }>('/payment-groups/members', {
    method: 'POST',
    body: { group, ...change },
  })
}

export function updateGroup(
  id: number,
  data: Partial<Pick<PaymentGroup, 'name' | 'note'>> & { responsible?: number | null },
) {
  return update<PaymentGroup>('payment-groups', id, data)
}

export function deleteGroup(id: number) {
  return remove<PaymentGroup>('payment-groups', id)
}
