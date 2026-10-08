<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { ApiError } from '@/api/client'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

function safeRedirect(value: unknown): string {
  // Yalnızca uygulama içi yollara yönlendir (açık yönlendirme açığını önler).
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function handleSubmit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value.trim(), password.value)
    await router.replace(safeRedirect(route.query.redirect))
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401
        ? 'E-posta veya şifre hatalı.'
        : e instanceof Error
          ? e.message
          : 'Giriş yapılamadı.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout title="Giriş yap" subtitle="Devam etmek için hesabınızla giriş yapın.">
    <form class="form" novalidate @submit.prevent="handleSubmit">
      <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

      <label class="field">
        <span>E-posta</span>
        <input
          v-model="email"
          type="email"
          autocomplete="username"
          required
          autofocus
          :disabled="loading"
        />
      </label>

      <label class="field">
        <span>Şifre</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="loading"
        />
      </label>

      <button
        type="submit"
        class="btn btn-primary btn-block"
        :disabled="loading || !email || !password"
      >
        {{ loading ? 'Giriş yapılıyor…' : 'Giriş yap' }}
      </button>

      <RouterLink to="/forgot-password" class="link-small">Şifremi unuttum</RouterLink>
    </form>
  </AuthLayout>
</template>
