import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppLayout from '@/layouts/AppLayout.vue'
import LoginView from '@/views/LoginView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** true ise giriş yapmadan erişilebilir. Varsayılan: tüm sayfalar korumalı. */
    public?: boolean
    title?: string
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { public: true, title: 'Giriş' },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/ForgotPasswordView.vue'),
      meta: { public: true, title: 'Şifremi unuttum' },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/ResetPasswordView.vue'),
      meta: { public: true, title: 'Şifre sıfırlama' },
    },
    {
      path: '/',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'dashboard',
          component: () => import('@/views/DashboardView.vue'),
          meta: { title: 'Panel' },
        },
        {
          path: 'umreciler',
          name: 'pilgrims',
          component: () => import('@/views/PilgrimsView.vue'),
          meta: { title: 'Umreciler' },
        },
        {
          path: 'umreciler/yeni',
          name: 'pilgrim-new',
          component: () => import('@/views/PilgrimFormView.vue'),
          meta: { title: 'Yeni umreci' },
        },
        {
          path: 'umreciler/:id(\\d+)',
          name: 'pilgrim-edit',
          component: () => import('@/views/PilgrimFormView.vue'),
          meta: { title: 'Umreci' },
        },
        {
          path: 'odalar',
          name: 'rooms',
          component: () => import('@/views/RoomsView.vue'),
          meta: { title: 'Odalar' },
        },
        {
          path: 'oda-tipleri',
          name: 'room-types',
          component: () => import('@/views/RoomTypesView.vue'),
          meta: { title: 'Oda Tipleri' },
        },
        {
          path: ':pathMatch(.*)*',
          name: 'not-found',
          component: () => import('@/views/NotFoundView.vue'),
          meta: { title: 'Sayfa bulunamadı' },
        },
      ],
    },
  ],
})

const GUEST_ONLY = new Set(['login', 'forgot-password', 'reset-password'])

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.fetchMe()

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if (auth.isAuthenticated && GUEST_ONLY.has(to.name as string)) {
    return { name: 'dashboard' }
  }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Vumre` : 'Vumre'
})

export default router
