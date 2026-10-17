<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="auth-page">
    <div class="card auth-card">
      <div class="auth-brand">Vumre</div>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="muted">{{ subtitle }}</p>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 1rem;
}

.auth-card {
  width: 100%;
  max-width: 400px;
}

.auth-brand {
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 1rem;
}

h1 {
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

.muted {
  margin-bottom: 1.5rem;
}
</style>
