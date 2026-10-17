import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import * as authApi from '@/api/auth'
import type { User } from '@/types/payload'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const initialized = ref(false)
  const isAuthenticated = computed(() => user.value !== null)
  // Bölge yöneticisi tüm umrecileri görür, yalnızca kendi bölgelerindekileri ekler ve düzenler;
  // geri kalan her şey admine ait.
  const isAdmin = computed(() => user.value?.role === 'admin')
  const managedRegionIds = computed(() =>
    user.value?.role === 'regionManager'
      ? (user.value.regions ?? []).map((r) => (typeof r === 'object' ? r.id : r))
      : [],
  )

  /** Bu bölgedeki umrecileri ekleyip düzenleyebilir mi? */
  function canEditRegion(regionId: number | null | undefined) {
    if (isAdmin.value) return true
    return regionId != null && managedRegionIds.value.includes(regionId)
  }

  let pending: Promise<void> | null = null

  /** Cookie'deki oturumu sunucudan doğrular. Uygulama açılışında bir kez çalışır. */
  function fetchMe(): Promise<void> {
    if (initialized.value) return Promise.resolve()
    pending ??= authApi
      .me()
      .then((res) => {
        user.value = res.user
      })
      .catch(() => {
        user.value = null
      })
      .finally(() => {
        initialized.value = true
        pending = null
      })
    return pending
  }

  async function login(username: string, password: string) {
    const res = await authApi.login(username, password)
    user.value = res.user
    initialized.value = true
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      clear()
    }
  }

  function clear() {
    user.value = null
    initialized.value = true
  }

  return {
    user,
    initialized,
    isAuthenticated,
    isAdmin,
    managedRegionIds,
    canEditRegion,
    fetchMe,
    login,
    logout,
    clear,
  }
})
