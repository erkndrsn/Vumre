<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const loggingOut = ref(false)

async function handleLogout() {
  loggingOut.value = true
  try {
    await auth.logout()
  } catch {
    // Sunucu hatası olsa bile yerel oturum temizlendi.
  } finally {
    loggingOut.value = false
    router.replace({ name: 'login' })
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <RouterLink to="/" class="brand">Vumre</RouterLink>
      <div class="topbar-user">
        <span class="user-email">{{ auth.user?.email }}</span>
        <button class="btn btn-secondary" :disabled="loggingOut" @click="handleLogout">
          Çıkış
        </button>
      </div>
    </header>

    <div class="app-body">
      <nav class="sidebar" aria-label="Ana menü">
        <RouterLink to="/" class="nav-link" exact-active-class="active">Panel</RouterLink>
        <RouterLink to="/umreciler" class="nav-link" active-class="active">Umreciler</RouterLink>
        <RouterLink to="/odalar" class="nav-link" active-class="active">Odalar</RouterLink>
        <RouterLink to="/oda-tipleri" class="nav-link" active-class="active"
          >Oda Tipleri</RouterLink
        >
      </nav>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.brand {
  font-weight: 700;
  font-size: 1.125rem;
  color: var(--color-heading);
  text-decoration: none;
}

.topbar-user {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.user-email {
  color: var(--color-muted);
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-body {
  flex: 1;
  display: flex;
}

.sidebar {
  width: 220px;
  flex-shrink: 0;
  padding: 1rem 0.75rem;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav-link {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius);
  color: var(--color-text);
  text-decoration: none;
}

.nav-link:hover {
  background: var(--color-hover);
}

.nav-link.active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

.content {
  flex: 1;
  min-width: 0;
  padding: 1.5rem;
}

@media (max-width: 720px) {
  .app-body {
    flex-direction: column;
  }

  .sidebar {
    width: auto;
    flex-direction: row;
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
    overflow-x: auto;
  }

  .content {
    padding: 1rem;
  }
}
</style>
