import type { Expense } from '@/types/payload'
import { create, find, remove } from './collections'

export async function listExpenses(limit = 0) {
  const res = await find<Expense>('expenses', { sort: '-paidAt', limit, depth: 1 })
  return res.docs
}

export function createExpense(
  data: Pick<Expense, 'description' | 'category' | 'amount' | 'paidAt'> & {
    cashbox: number
  } & Partial<Pick<Expense, 'payee' | 'receiptNo' | 'note'>>,
) {
  return create<Expense>('expenses', data)
}

export function deleteExpense(id: number) {
  return remove<Expense>('expenses', id)
}
