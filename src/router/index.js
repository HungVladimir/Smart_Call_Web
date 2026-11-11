import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import ContactsView from '../views/ContactsView.vue'
import HistoryView from '../views/HistoryView.vue'
// Import service Wazo để kiểm tra trạng thái đăng nhập
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
      path: '/contacts',
      name: 'Contacts',
      component: ContactsView,
      meta: { requiresAuth: true, title: 'Danh bạ' },
    },
    {
      path: '/history',
      name: 'History',
      component: HistoryView,
      meta: { requiresAuth: true, title: 'Lịch sử gọi' },
    },
  ],
})

// Navigation Guard: Bảo vệ các route cần đăng nhập
// Lưu ý: Không dùng tham số next(), chỉ dùng return
router.beforeEach((to, from) => {
  // Cập nhật tiêu đề trang
  if (to.meta.title) {
    document.title = `${to.meta.title} - SDV Wazo`
  }

  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)

  if (requiresAuth) {
    // Kiểm tra xem user đã đăng nhập và có token hợp lệ chưa
    if (wazoService.isLogged()) {
      // Cho phép đi tiếp
      return
    } else {
      // Chưa đăng nhập -> Chuyển về login
      // Lưu lại đường dẫn hiện tại để sau khi login xong có thể quay lại
      return {
        path: '/login',
        query: { redirect: to.fullPath },
      }
    }
  } else {
    // Nếu không yêu cầu auth (ví dụ trang login), nhưng user đã login rồi thì chặn không cho login lại
    if (to.name === 'Login' && wazoService.isLogged()) {
      // Đã login rồi -> Chuyển về dashboard
      return '/dashboard'
    } else {
      // Cho phép đi tiếp
      return
    }
  }
})

export default router