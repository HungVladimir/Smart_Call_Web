import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import HistoryView from '../views/HistoryView.vue'
import CallsView from '../views/CallsView.vue'
import MessagesView from '../views/MessagesView.vue'
import { wazoService } from '../services/wazo'
import { isFeatureEnabled, getFeatures } from '../config/features'

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
      path: '/dashboard',
      redirect: '/calls',
    },
    {
      path: '/contacts',
      redirect: '/calls',
    },
    {
      path: '/calls',
      name: 'Calls',
      component: CallsView,
      meta: { requiresAuth: true, title: 'Gọi điện & Danh bạ', featureKey: 'calls' },
    },
    {
      path: '/messages',
      name: 'Messages',
      component: MessagesView,
      meta: { requiresAuth: true, title: 'Tin nhắn phòng chat', featureKey: 'messages' },
    },
    {
      path: '/history',
      name: 'History',
      component: HistoryView,
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

  // Check login: kiểm tra cờ đăng nhập, token phiên làm việc hoặc chế độ thử nghiệm
  const hasSavedToken = Boolean(localStorage.getItem('smartcall_wazo_token'))
  const isOffline = localStorage.getItem('smartcall_offline_mode') === 'true'
  const isLogged =
    localStorage.getItem('smartcall_logged_in') === 'true' &&
    (wazoService.isLogged() || hasSavedToken || isOffline)
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)

  if (requiresAuth && !isLogged) {
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.name === 'Login' && isLogged) {
    return getFirstAvailableRoute()
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
