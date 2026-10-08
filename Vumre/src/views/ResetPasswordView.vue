<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { resetPassword } from '@/api/auth'

const MIN_LENGTH = 8

const route = useRoute()
const router = useRouter()

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const loading = ref(false)
const error = ref('')

async function handleSubmit() {
  error.value = ''
  if (password.value.length < MIN_LENGTH) {
    error.value = `Şifre en az ${MIN_LENGTH} karakter olmalı.`
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Şifreler eşleşmiyor.'
    return
  }
  loading.value = true
  try {
    await resetPassword(token.value, password.value)
    await router.replace({ name: 'login' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Şifre sıfırlanamadı.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout title="Yeni şifre belirle">
    <div v-if="!token" class="alert alert-error" role="alert">
      Geçersiz veya eksik sıfırlama bağlantısı.
    </div>

    <form v-else class="form" novalidate @submit.prevent="handleSubmit">
      <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

      <label class="field">
        <span>Yeni şifre</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          :disabled="loading"
        />
      </label>

      <label class="field">
        <span>Yeni şifre (tekrar)</span>
        <input
          v-model="confirm"
          type="password"
          autocomplete="new-password"
          required
          :disabled="loading"
        />
      </label>

      <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
        {{ loading ? 'Kaydediliyor…' : 'Şifreyi kaydet' }}
      </button>
    </form>

    <RouterLink to="/login" class="link-small">Girişe dön</RouterLink>
  </AuthLayout>
</template>
