<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { forgotPassword } from '@/api/auth'

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref('')

async function handleSubmit() {
  error.value = ''
  loading.value = true
  try {
    await forgotPassword(email.value.trim())
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
    subtitle="E-posta adresinizi girin, şifre sıfırlama bağlantısı gönderelim."
  >
    <div v-if="sent" class="alert alert-success" role="status">
      Bu adrese kayıtlı bir hesap varsa sıfırlama bağlantısı gönderildi.
    </div>

    <form v-else class="form" novalidate @submit.prevent="handleSubmit">
      <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

      <label class="field">
        <span>E-posta</span>
        <input v-model="email" type="email" autocomplete="email" required :disabled="loading" />
      </label>

      <button type="submit" class="btn btn-primary btn-block" :disabled="loading || !email">
        {{ loading ? 'Gönderiliyor…' : 'Bağlantı gönder' }}
      </button>
    </form>

    <RouterLink to="/login" class="link-small">Girişe dön</RouterLink>
  </AuthLayout>
</template>
