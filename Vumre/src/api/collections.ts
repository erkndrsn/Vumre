import type { PaginatedDocs, Where } from '@/types/payload'
import { request } from './client'

export interface FindParams {
  where?: Where
  limit?: number
  page?: number
  sort?: string
  depth?: number
  locale?: string
}

/** İç içe objeleri Payload'un beklediği `where[field][op]=value` formatına çevirir. */
export function serializeQuery(params: object): string {
  const parts: string[] = []
  const walk = (value: unknown, prefix: string) => {
    if (value === undefined) return
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        walk(inner, prefix ? `${prefix}[${key}]` : key)
      }
      return
    }
    parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`)
  }
  walk(params, '')
  return parts.length ? `?${parts.join('&')}` : ''
}

export function find<T>(slug: string, params: FindParams = {}) {
  return request<PaginatedDocs<T>>(`/${slug}${serializeQuery(params)}`)
}

export function findById<T>(slug: string, id: string | number, params: { depth?: number } = {}) {
  return request<T>(`/${slug}/${id}${serializeQuery(params)}`)
}

export async function create<T>(slug: string, data: Partial<T> | FormData) {
  const res = await request<{ doc: T }>(`/${slug}`, { method: 'POST', body: data })
  return res.doc
}

export async function update<T>(slug: string, id: string | number, data: Partial<T> | FormData) {
  const res = await request<{ doc: T }>(`/${slug}/${id}`, { method: 'PATCH', body: data })
  return res.doc
}

export function remove<T>(slug: string, id: string | number) {
  return request<T>(`/${slug}/${id}`, { method: 'DELETE' })
}
