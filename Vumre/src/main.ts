import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { onUnauthorized } from './api/client'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Oturum süresi dolduğunda (401) kullanıcıyı login'e geri gönder.
onUnauthorized(() => {
  useAuthStore().clear()
  const current = router.currentRoute.value
  if (!current.meta.public) {
    router.replace({ name: 'login', query: { redirect: current.fullPath } })
  }
})

app.mount('#app')
