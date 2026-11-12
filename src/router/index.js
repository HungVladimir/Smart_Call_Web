import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import ContactsView from '../views/ContactsView.vue'
import HistoryView from '../views/HistoryView.vue'
import CallsView from '../views/CallsView.vue'
import MessagesView from '../views/MessagesView.vue'
import { wazoService } from '../services/wazo'

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
      redirect: '/dashboard',
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: DashboardView,
      meta: { requiresAuth: true, title: 'Tổng quan' },
    },
    {
      path: '/calls',
      name: 'Calls',
      component: CallsView,
      meta: { requiresAuth: true, title: 'Gọi thoại & Bàn phím' },
    },
    {
      path: '/contacts',
      name: 'Contacts',
      component: ContactsView,
      meta: { requiresAuth: true, title: 'Danh bạ' },
    },
    {
      path: '/messages',
      name: 'Messages',
      component: MessagesView,
      meta: { requiresAuth: true, title: 'Tin nhắn phòng chat' },
    },
    {
      path: '/history',
      name: 'History',
      component: HistoryView,
      meta: { requiresAuth: true, title: 'Lịch sử gọi' },
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
    return '/dashboard'
  }
})

export default router
