import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, onUnauthorized, request } from '../client'
import { serializeQuery } from '../collections'

function mockFetch(status: number, body: unknown) {
  const fn = vi
    .fn()
    .mockResolvedValue(new Response(body === undefined ? '' : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

describe('request', () => {
  it('cookie ile /api önekiyle istek atar ve JSON döner', async () => {
    const fetchMock = mockFetch(200, { ok: true })

    const data = await request<{ ok: boolean }>('/users/me')

    expect(data).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/users/me')
    expect(init.credentials).toBe('include')
  })

  it('body varsa JSON olarak gönderir', async () => {
    const fetchMock = mockFetch(200, {})

    await request('/users/login', { method: 'POST', body: { email: 'a@b.c' } })

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.body).toBe('{"email":"a@b.c"}')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('Payload hata mesajını ApiError olarak fırlatır', async () => {
    mockFetch(400, { errors: [{ message: 'Geçersiz alan' }] })

    await expect(request('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'Geçersiz alan',
    })
  })

  it('401 olduğunda kayıtlı handler çağrılır', async () => {
    mockFetch(401, { errors: [{ message: 'Unauthorized' }] })
    const handler = vi.fn()
    onUnauthorized(handler)

    await expect(request('/x')).rejects.toBeInstanceOf(ApiError)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('skipUnauthorizedHandler ile 401 handler çağrılmaz', async () => {
    mockFetch(401, {})
    const handler = vi.fn()
    onUnauthorized(handler)

    await expect(request('/x', { skipUnauthorizedHandler: true })).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('ağ hatasında status 0 ile ApiError fırlatır', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(request('/x')).rejects.toMatchObject({ status: 0 })
  })
})

describe('serializeQuery', () => {
  it('where sorgusunu Payload formatına çevirir', () => {
    const qs = serializeQuery({ where: { status: { equals: 'active' } }, limit: 10 })
    expect(decodeURIComponent(qs)).toBe('?where[status][equals]=active&limit=10')
  })

  it('boş parametrede boş string döner', () => {
    expect(serializeQuery({})).toBe('')
  })
})
