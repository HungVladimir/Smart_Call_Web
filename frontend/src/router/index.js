import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import { authService } from '@/services/index.js'

import { isFeatureEnabled, getFeatures } from '../config/features.js'

/** Chọn trang đầu tiên còn được bật theo thứ tự gọi, gọi nhóm, lịch sử; login là đường lui an toàn. */
const getFirstAvailableRoute = () => {
  const f = getFeatures()
  if (f.calls) return '/calls'
  if (f.callGroups) return '/call-groups'
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
      redirect: getFirstAvailableRoute,
    },
    {
      path: '/calls',
      name: 'Calls',
      component: () => import('../views/CallsView.vue'),
      meta: { requiresAuth: true, title: 'Gọi điện & Danh bạ', featureKey: 'calls' },
    },
    { path: '/messages', redirect: '/calls' },
    {
      path: '/call-groups',
      name: 'CallGroups',
      component: () => import('../views/CallGroupsView.vue'),
      meta: { requiresAuth: true, title: 'Gọi nhóm', featureKey: 'callGroups' },
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

/** Kiểm tra record route có yêu cầu người dùng đã xác thực hay không. */
function isAuthRequiredRecord(record) {
  return Boolean(record.meta.requiresAuth)
}

/**
 * Kiểm tra trạng thái đăng nhập và cờ phân hệ trước mỗi lần điều hướng; chuyển hướng an toàn về
 * trang đăng nhập hoặc route khả dụng đầu tiên khi route đích không hợp lệ.
 */
function guardRouteNavigation(to) {
  if (to.meta.title) {
    document.title = `${to.meta.title} - SmartCall Web`
  }

  // Phải xác nhận cả cờ đăng nhập lẫn phiên SDK/token để tránh vào màn hình riêng tư khi phiên vừa bị thu hồi.
  const isLogged =
    localStorage.getItem('smartcall_logged_in') === 'true' && authService.isAuthenticated()
  const requiresAuth = to.matched.some(isAuthRequiredRecord)

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

  // Chặn truy cập trực tiếp qua URL vào phân hệ đang tắt trong cấu hình người dùng.
  if (to.meta.featureKey && !isFeatureEnabled(to.meta.featureKey)) {
    const target = getFirstAvailableRoute()
    if (target !== to.path) {
      return target
    }
  }
}

router.beforeEach(guardRouteNavigation)

export default router
