import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '../auth'
import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'

vi.mock('@/api/auth')

const user = { id: 1, username: 'test', email: 'test@example.com', createdAt: '', updatedAt: '' }

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })

  it('fetchMe oturumu geri yükler ve yalnızca bir kez istek atar', async () => {
    vi.mocked(authApi.me).mockResolvedValue({ user })
    const store = useAuthStore()

    await Promise.all([store.fetchMe(), store.fetchMe()])
    await store.fetchMe()

    expect(store.isAuthenticated).toBe(true)
    expect(store.user?.username).toBe('test')
    expect(authApi.me).toHaveBeenCalledOnce()
  })

  it('fetchMe hata alırsa girişsiz kabul eder', async () => {
    vi.mocked(authApi.me).mockRejectedValue(new ApiError('down', 0))
    const store = useAuthStore()

    await store.fetchMe()

    expect(store.initialized).toBe(true)
    expect(store.isAuthenticated).toBe(false)
  })

  it('login kullanıcıyı ayarlar', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user })
    const store = useAuthStore()

    await store.login('test', 'secret')

    expect(authApi.login).toHaveBeenCalledWith('test', 'secret')
    expect(store.isAuthenticated).toBe(true)
  })

  it('logout sunucu hata verse bile oturumu temizler', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user })
    vi.mocked(authApi.logout).mockRejectedValue(new ApiError('down', 0))
    const store = useAuthStore()
    await store.login('test', 'secret')

    await expect(store.logout()).rejects.toBeInstanceOf(ApiError)

    expect(store.isAuthenticated).toBe(false)
  })
})
