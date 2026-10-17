<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { forgotPassword } from '@/api/auth'

const username = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref('')

async function handleSubmit() {
  error.value = ''
  loading.value = true
  try {
    await forgotPassword(username.value.trim())
    sent.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'İstek gönderilemedi.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthLayout
    title="Şifremi unuttum"
    subtitle="Kullanıcı adınızı girin; hesabınıza kayıtlı e-posta adresine şifre sıfırlama bağlantısı gönderelim."
  >
    <div v-if="sent" class="alert alert-success" role="status">
      Bu kullanıcı adına kayıtlı bir e-posta adresi varsa sıfırlama bağlantısı gönderildi. E-postası
      olmayan hesapların şifresini admin yenileyebilir.
    </div>

    <form v-else class="form" novalidate @submit.prevent="handleSubmit">
      <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

      <label class="field">
        <span>Kullanıcı adı</span>
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          required
          :disabled="loading"
        />
      </label>

      <button type="submit" class="btn btn-primary btn-block" :disabled="loading || !username">
        {{ loading ? 'Gönderiliyor…' : 'Bağlantı gönder' }}
      </button>
    </form>

    <RouterLink to="/login" class="link-small">Girişe dön</RouterLink>
  </AuthLayout>
</template>
