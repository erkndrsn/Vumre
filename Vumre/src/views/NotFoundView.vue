<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section>
    <h1>Sayfa bulunamadı</h1>
    <p class="muted">Aradığınız sayfa mevcut değil veya taşınmış olabilir.</p>
    <RouterLink to="/" class="btn btn-secondary">Panele dön</RouterLink>
  </section>
</template>

<style scoped>
h1 {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

.muted {
  margin-bottom: 1rem;
}
</style>
