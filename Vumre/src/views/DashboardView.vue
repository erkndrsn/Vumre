<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <section>
    <h1>Hoş geldiniz</h1>
    <p class="muted">{{ auth.user?.email }} olarak giriş yaptınız.</p>

    <div class="card placeholder">
      <p>İç işlem ekranları buraya eklenecek.</p>
    </div>
  </section>
</template>

<style scoped>
h1 {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

.placeholder {
  margin-top: 1.5rem;
  color: var(--color-muted);
}
</style>
