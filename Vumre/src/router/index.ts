import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppLayout from '@/layouts/AppLayout.vue'
import LoginView from '@/views/LoginView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** true ise giriş yapmadan erişilebilir. Varsayılan: tüm sayfalar korumalı. */
    public?: boolean
    title?: string
    /** true ise bölge yöneticisi de girebilir. Varsayılan: sayfa yalnızca admine açık. */
    regionManager?: boolean
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
          meta: { title: 'Panel', regionManager: true },
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
          meta: { title: 'Yeni umreci', regionManager: true },
        },
        {
          path: 'umreciler/bolge-listesi',
          name: 'pilgrims-by-region',
          component: () => import('@/views/RegionalPilgrimsView.vue'),
          meta: { title: 'Bölge Listesi', regionManager: true },
        },
        {
          path: 'umreciler/:id(\\d+)',
          name: 'pilgrim-edit',
          component: () => import('@/views/PilgrimFormView.vue'),
          meta: { title: 'Umreci', regionManager: true },
        },
        {
          path: 'yerlesim',
          name: 'room-board',
          component: () => import('@/views/RoomBoardView.vue'),
          meta: { title: 'Oda Yerleşimi', regionManager: true },
        },
        {
          path: 'tahsilat',
          name: 'payments',
          component: () => import('@/views/PaymentsView.vue'),
          meta: { title: 'Tahsilat' },
        },
        {
          path: 'odeme-takibi',
          name: 'debts',
          component: () => import('@/views/DebtsView.vue'),
          meta: { title: 'Ödeme Takibi' },
        },
        {
          path: 'odeme-gruplari',
          name: 'payment-groups',
          component: () => import('@/views/PaymentGroupsView.vue'),
          meta: { title: 'Ödeme Grupları' },
        },
        {
          path: 'kasa',
          name: 'cash',
          component: () => import('@/views/CashView.vue'),
          meta: { title: 'Kasa' },
        },
        {
          path: 'kasa/:id',
          name: 'cashbox-ledger',
          component: () => import('@/views/CashboxLedgerView.vue'),
          meta: { title: 'Kasa Dökümü' },
        },
        {
          path: 'bolgeler',
          name: 'regions',
          component: () => import('@/views/RegionsView.vue'),
          meta: { title: 'Bölgeler' },
        },
        {
          path: 'bolge-yoneticileri',
          name: 'region-managers',
          component: () => import('@/views/RegionManagersView.vue'),
          meta: { title: 'Bölge Yöneticileri' },
        },
        {
          path: 'ucus-noktalari',
          name: 'flight-points',
          component: () => import('@/views/FlightPointsView.vue'),
          meta: { title: 'Uçuş Noktaları' },
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
          meta: { title: 'Sayfa bulunamadı', regionManager: true },
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
  // Bölge yöneticisi yalnızca panele, bölge listesine, umreci düzenlemeye ve oda yerleşimine girer.
  if (auth.isAuthenticated && !auth.isAdmin && !to.meta.public && !to.meta.regionManager) {
    return { name: 'pilgrims-by-region' }
  }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Vumre` : 'Vumre'
})

export default router
