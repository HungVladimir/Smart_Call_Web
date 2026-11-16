<template>
  <div id="app" class="app-container">
    <!-- 1. Thanh Top Header (Chỉ hiện khi đã đăng nhập) -->
    <AppHeader
      v-if="isLoggedIn && !isLoginPage"
      @logout="handleLogout"
      @open-settings="showSettings = true"
    />

    <!-- 2. Thân ứng dụng chính -->
    <div v-if="isLoggedIn && !isLoginPage" class="app-body">
      <!-- Sidebar điều hướng bên trái -->
      <AppSidebar />

      <!-- Nội dung chính của từng trang với KeepAlive mượt mà, chuyển tab 0ms -->
      <main class="app-content">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" :key="`${callStore.myUserUuid || 'guest'}-${$route.name}`" />
          </keep-alive>
        </router-view>
      </main>
    </div>

    <!-- Màn hình Login hiển thị toàn màn hình nếu chưa đăng nhập hoặc đang ở trang Login -->
    <div v-else class="login-fullscreen">
      <router-view />
    </div>

    <!-- 3. Modal Cài đặt hệ thống (Settings Modal) -->
    <SettingsModal :is-open="showSettings" @close="showSettings = false" />

    <!-- 4. Modal Cuộc gọi đến WebRTC (Single Source of Truth) -->
    <IncomingCallModal
      :is-open="showIncomingModal"
      :call-data="incomingCallData"
      @accept="onAcceptIncomingCall"
      @reject="onRejectIncomingCall"
      @timeout="onMissedIncomingCall"
    />

    <!-- 5. Thông báo Toast nổi -->
    <transition name="slide-fade">
      <div v-if="toastMessage" class="toast-notification" :class="toastType">
        {{ toastMessage }}
      </div>
    </transition>

    <!-- 6. Bảng Nhật ký Debug thao tác & Sự kiện WebRTC thời gian thực -->
    <DebugLogDrawer />

    <!-- 7. Modal Cảnh báo Đăng nhập 1 Thiết bị (Single Device Login - Mục 9) -->
    <div v-if="showKickedModal" class="kicked-modal-overlay">
      <div class="kicked-modal-card">
        <div class="kicked-modal-icon">⚠️</div>
        <h3 class="kicked-modal-title">Tài Khoản Đã Đăng Nhập Nơi Khác</h3>
        <p class="kicked-modal-desc">
          Phiên làm việc của bạn đã kết thúc vì tài khoản vừa được đăng nhập trên một thiết bị khác (ứng dụng di động hoặc trình duyệt khác).
        </p>
        <button class="btn-relogin-submit" @click="handleRelogin">Đăng nhập lại</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { wazoService, callStore } from '@/services/wazo'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import SettingsModal from '@/components/common/SettingsModal.vue'
import IncomingCallModal from '@/components/call/IncomingCallModal.vue'
import DebugLogDrawer from '@/components/common/DebugLogDrawer.vue'

const router = useRouter()
const route = useRoute()

// --- State Management ---
const isLoggedIn = ref(false)
const showSettings = ref(false)
const showKickedModal = ref(false)

const handleSessionKicked = () => {
  showKickedModal.value = true
}

const handleRelogin = () => {
  showKickedModal.value = false
  handleLogout()
}

// Trạng thái cuộc gọi đến reactive từ callStore (SSOT)
const showIncomingModal = computed(() => Boolean(callStore.incomingCall))
const incomingCallData = computed(() => callStore.incomingCall)

const isLoginPage = computed(() => route.path === '/login')

// Toast Notification System
const toastMessage = ref('')
const toastType = ref('info')
let toastTimer = null

// --- Lifecycle ---
onMounted(async () => {
  // 1. Kiểm tra trạng thái đăng nhập
  const storedLogin = localStorage.getItem('smartcall_logged_in')
  if (storedLogin !== 'false' && (storedLogin === 'true' || wazoService.isLogged())) {
    isLoggedIn.value = true
    // Tự động khôi phục phiên Wazo từ Token lưu trữ khi có kết nối
    if (!wazoService.session && localStorage.getItem('smartcall_offline_mode') !== 'true') {
      await wazoService.restoreSession()
    }
    tryConnectPhone()
  } else {
    isLoggedIn.value = false
    if (route.path !== '/login') {
      router.push('/login')
    }
  }

  // 2. Lắng nghe các sự kiện ứng dụng
  window.addEventListener('app-action', handleAppAction)
  window.addEventListener('app-toast', handleToastEvent)
  window.addEventListener('app-login-success', handleLoginSuccess)
  window.addEventListener('smartcall-session-kicked', handleSessionKicked)
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  window.removeEventListener('app-action', handleAppAction)
  window.removeEventListener('app-toast', handleToastEvent)
  window.removeEventListener('app-login-success', handleLoginSuccess)
  window.removeEventListener('smartcall-session-kicked', handleSessionKicked)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  wazoService.disconnectPhone()
})

const handleBeforeUnload = () => {
  if (wazoService.hasActiveCall()) {
    wazoService.hangup()
  }
}

// --- Logic kết nối & Đăng nhập ---
const handleLoginSuccess = () => {
  isLoggedIn.value = true
  tryConnectPhone()
}

const tryConnectPhone = async () => {
  if (localStorage.getItem('smartcall_offline_mode') === 'true') {
    return
  }
  try {
    await wazoService.connectPhone()
    showToast('Tổng đài: Kết nối thoại sẵn sàng!', 'success')
  } catch (err) {
    console.info('Hệ thống khởi chạy ở chế độ ngoại tuyến dự phòng:', err.message)
  }
}

// --- Xử lý sự kiện Modal cuộc gọi đến (Điều hướng qua wazoService) ---
const onAcceptIncomingCall = (callData) => {
  const ext = callData?.extension || callData?.number || '1002'
  wazoService.acceptIncomingCall(callData)
  showToast(`Đã nhận cuộc gọi từ ${callData?.name || ext}!`, 'success')

  // Chuyển sang màn hình CallsView đang đàm thoại
  router.push({
    path: '/calls',
    query: {
      number: ext,
      name: callData?.name || '',
      dept: callData?.dept || '',
      active: 'true',
      direction: 'inbound',
    },
  })
}

const onRejectIncomingCall = (callData) => {
  wazoService.rejectIncomingCall(callData)
  showToast('Đã từ chối cuộc gọi.', 'info')
}

const onMissedIncomingCall = (callData) => {
  const name = callData?.name || callStore.incomingCall?.name || 'Đồng nghiệp'
  wazoService.missIncomingCall(callData)
  showToast(`Cuộc gọi nhỡ từ ${name}`, 'warning')
}

const handleAppAction = (event) => {
  const { type, value } = event.detail
  if (type === 'dial') {
    onDial(value)
  }
}

const handleToastEvent = (event) => {
  if (event.detail && event.detail.message) {
    showToast(event.detail.message, event.detail.type || 'info')
  }
}

// --- Thao tác người dùng ---
const handleLogout = () => {
  wazoService.logout()
  localStorage.setItem('smartcall_logged_in', 'false')
  localStorage.removeItem('smartcall_offline_mode')
  isLoggedIn.value = false
  router.push('/login')
}

const onDial = (extension) => {
  const cleanExt = String(extension || '').trim()
  if (!cleanExt) return
  router.push({
    path: '/calls',
    query: { number: cleanExt, autocall: 'true' },
  })
}

// --- Helper Toast ---
const showToast = (message, type = 'info') => {
  toastMessage.value = message
  toastType.value = type
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 4000)
}
</script>

<style>
/* Reset & Base toàn app */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

body {
  background-color: #f4f7f9;
  color: #2c3e50;
  overflow: hidden;
}
</style>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-body {
  display: flex;
  flex: 1;
  height: calc(100vh - 56px);
  overflow: hidden;
}

.app-content {
  flex: 1;
  overflow-y: auto;
  background-color: #f4f7f9;
  padding: 24px;
}

@media (max-width: 768px) {
  .app-body {
    flex-direction: column-reverse;
    height: calc(100vh - 50px);
  }

  .app-content {
    padding: 12px 10px;
  }
}

.login-fullscreen {
  height: 100vh;
  width: 100vw;
  overflow-y: auto;
}

/* Toast Notification Animation */
.toast-notification {
  position: fixed;
  top: 70px;
  right: 24px;
  padding: 12px 20px;
  border-radius: 8px;
  background-color: #1e293b;
  color: white;
  font-weight: 500;
  line-height: 1.45;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  z-index: 9999;
  min-width: 250px;
  max-width: 440px;
  font-size: 0.9rem;
  word-break: break-word;
}

.toast-notification.info {
  background-color: #0284c7;
}
.toast-notification.success {
  background-color: #10b981;
}
.toast-notification.warning {
  background-color: #d97706;
  border: 1px solid #b45309;
}
.toast-notification.error {
  background-color: #ef4444;
}

.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}
.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(1, 0.5, 0.8, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

/* Modal Single Device Login Kicked */
.kicked-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(6px);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.kicked-modal-card {
  background: white;
  width: 100%;
  max-width: 440px;
  border-radius: 16px;
  padding: 32px 28px;
  text-align: center;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: modal-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.kicked-modal-icon {
  font-size: 3rem;
  margin-bottom: 12px;
}

.kicked-modal-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 10px 0;
}

.kicked-modal-desc {
  font-size: 0.88rem;
  color: #475569;
  line-height: 1.5;
  margin: 0 0 24px 0;
}

.btn-relogin-submit {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.btn-relogin-submit:hover {
  background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
  transform: translateY(-1px);
}
</style>
