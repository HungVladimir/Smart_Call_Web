import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import { authService } from '@/services/index.js'

import { isFeatureEnabled, getFeatures } from '../config/features.js'

/** Chọn trang đầu tiên còn được bật theo thứ tự gọi, tin nhắn, lịch sử; login là đường lui an toàn. */
const getFirstAvailableRoute = () => {
  const f = getFeatures()
  if (f.calls) return '/calls'
  if (f.messages) return '/messages'
  if (f.history) return '/history'
  return '/login'
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/logout', name: 'SingleIdLoggedOut', redirect: '/login' },
    {
      path: '/callback',
      name: 'SingleIdCallback',
      component: () => import('../views/CallbackView.vue'),
      meta: { title: 'Đăng nhập Single ID' },
    },
    {
      path: '/login',
      name: 'Login',
      component: LoginView,
      meta: { title: 'Đăng nhập' },
    },
    {
      path: '/',
      redirect: () => getFirstAvailableRoute(),
    },
    {
      path: '/calls',
      name: 'Calls',
      component: () => import('../views/CallsView.vue'),
      meta: { requiresAuth: true, title: 'Gọi điện & Danh bạ', featureKey: 'calls' },
    },
    {
      path: '/messages',
      name: 'Messages',
      component: () => import('../views/MessagesView.vue'),
      meta: { requiresAuth: true, title: 'Tin nhắn phòng chat', featureKey: 'messages' },
    },
    {
      path: '/history',
      name: 'History',
      component: () => import('../views/HistoryView.vue'),
      meta: { requiresAuth: true, title: 'Lịch sử gọi', featureKey: 'history' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/calls',
    },
  ],
})

// Navigation Guard
router.beforeEach((to) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - SmartCall Web`
  }

  // Check login: kiểm tra cờ đăng nhập và token phiên làm việc Wazo
  const isLogged =
    localStorage.getItem('smartcall_logged_in') === 'true' && authService.isAuthenticated()
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)

  if (requiresAuth && !isLogged) {
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.name === 'Login' && isLogged) {
    const target = getFirstAvailableRoute()
    if (target !== to.path) return target
  }

  // Kiểm tra cờ tính năng (Feature Flag)
  if (to.meta.featureKey && !isFeatureEnabled(to.meta.featureKey)) {
    const target = getFirstAvailableRoute()
    if (target !== to.path) {
      return target
    }
  }
})

export default router
