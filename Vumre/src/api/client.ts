import type { PayloadErrorResponse } from '@/types/payload'

export const API_BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly data: PayloadErrorResponse | null

  constructor(message: string, status: number, data: PayloadErrorResponse | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

let unauthorizedHandler: (() => void) | null = null

/** 401 yanıtlarında çağrılacak callback'i kaydeder (ör. oturumu temizleyip login'e yönlendirme). */
export function onUnauthorized(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** true ise 401 yanıtında global handler çağrılmaz (login, me gibi istekler için). */
  skipUnauthorizedHandler?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, skipUnauthorizedHandler, ...rest } = options
  const isFormData = body instanceof FormData
  const init: RequestInit = {
    credentials: 'include',
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  }
  if (body !== undefined) {
    init.body = isFormData ? body : JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new ApiError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.', 0)
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const errorData = data as PayloadErrorResponse | null
    // ValidationError'da asıl açıklama alan hatasındadır ("Oda 101 dolu (3/3)…").
    const message =
      errorData?.errors?.[0]?.data?.errors?.[0]?.message ||
      errorData?.errors?.[0]?.message ||
      errorData?.message ||
      (response.status >= 500
        ? 'Sunucuya ulaşılamadı veya bir hata oluştu.'
        : `İstek başarısız oldu (${response.status}).`)
    if (response.status === 401 && !skipUnauthorizedHandler) {
      unauthorizedHandler?.()
    }
    throw new ApiError(message, response.status, errorData)
  }

  return data as T
}

/**
 * Dosya döndüren bir GET isteğini indirir. Hata yanıtı (JSON) dosya olarak inmesin diye
 * önce durum kontrol edilir; hata mesajı ApiError olarak fırlatılır.
 */
export async function download(path: string, fallbackName: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { credentials: 'include' })
  } catch {
    throw new ApiError('Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.', 0)
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as PayloadErrorResponse | null
    if (response.status === 401) unauthorizedHandler?.()
    throw new ApiError(
      data?.errors?.[0]?.message || data?.message || `İndirme başarısız (${response.status}).`,
      response.status,
      data,
    )
  }
  const name =
    response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] || fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
