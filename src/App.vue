<template>
  <div id="app" class="app-container">
    <!-- 1. Thanh Header (Chỉ hiện khi đã đăng nhập) -->
    <Navbar v-if="isLoggedIn" @logout="handleLogout" />

    <!-- 2. Nội dung chính (Router View) -->
    <main class="app-main">
      <router-view />
    </main>

    <!-- 3. Panel Điều khiển Cuộc gọi (Floating Component) -->
    <!-- Hiển thị khi đang có cuộc gọi HOẶC đã kết nối Phone thành công -->
    <CallControlPanel
      v-show="isPhoneConnected || hasActiveCall"
      :current-call="currentCall"
      :phone-status="phoneStatus"
      @hangup="onHangup"
      @accept="onAccept"
      @reject="onReject"
      @mute="onToggleMute"
      @hold="onToggleHold"
      @dial="onDial"
    />

    <!-- 4. Thông báo Toast (Toasts/Alerts) -->
    <transition name="slide-fade">
      <div v-if="toastMessage" class="toast-notification" :class="toastType">
        {{ toastMessage }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { wazoService } from '@/services/wazo'
import CallControlPanel from '@/components/call/CallControlPanel.vue'
import Navbar from '@/components/layout/Navbar.vue'

const router = useRouter()

// --- State Management ---
const isLoggedIn = ref(false)
const isPhoneConnected = ref(false)
const phoneStatus = ref('disconnected') // disconnected, connecting, connected, error
const currentCall = ref(null)
const hasActiveCall = ref(false)

// Toast Notification System
const toastMessage = ref('')
const toastType = ref('info') // info, success, error
let toastTimer = null

// --- Lifecycle ---

onMounted(async () => {
  // 1. Kiểm tra phiên đăng nhập
  if (wazoService.isLogged()) {
    isLoggedIn.value = true
    // Tự động kết nối Phone nếu user đã login trước đó (Silent Connect)
    tryConnectPhone()
  } else {
    // Chưa login -> Chuyển về trang đăng nhập
    router.push('/login')
  }

  // 2. Lắng nghe sự kiện toàn cục (Global Event Listeners)
  // Các component con (như ContactsView) sẽ dispatch event này để yêu cầu hành động
  window.addEventListener('app-action', handleAppAction)

  // Lắng nghe sự kiện từ Wazo SDK (qua Service)
  window.addEventListener('wazo-incoming', handleIncomingCall)
  window.addEventListener('wazo-ended', handleCallEnded)
})

onUnmounted(() => {
  // Dọn dẹp sự kiện khi đóng app
  window.removeEventListener('app-action', handleAppAction)
  window.removeEventListener('wazo-incoming', handleIncomingCall)
  window.removeEventListener('wazo-ended', handleCallEnded)

  // Ngắt kết nối Phone sạch sẽ
  wazoService.disconnectPhone()
})

// --- Logic Kết nối & Xử lý Sự kiện ---

const tryConnectPhone = async () => {
  phoneStatus.value = 'connecting'
  showToast('Đang kết nối đến tổng đài...', 'info')

  try {
    await wazoService.connectPhone()
    isPhoneConnected.value = true
    phoneStatus.value = 'connected'
    showToast('Kết nối thành công!', 'success')
  } catch (err) {
    phoneStatus.value = 'error'
    console.error('Kết nối phone thất bại:', err)
    showToast('Không thể kết nối Wazo. Kiểm tra SSL/Mạng.', 'error')
  }
}

const handleIncomingCall = (event) => {
  currentCall.value = event.detail
  hasActiveCall.value = true
  showToast(`Cuộc gọi đến từ: ${event.detail.remote_name || event.detail.extension}`, 'info')
}

const handleCallEnded = (event) => {
  currentCall.value = null
  hasActiveCall.value = false
}

// Xử lý các hành động từ Component khác (ví dụ: Gọi từ Danh bạ)
const handleAppAction = (event) => {
  const { type, value } = event.detail
  if (type === 'dial') {
    onDial(value)
  }
}

// --- Actions (Gọi lại Service) ---

const handleLogout = () => {
  wazoService.logout()
  isLoggedIn.value = false
  isPhoneConnected.value = false
  currentCall.value = null
  hasActiveCall.value = false

  router.push('/login')
}

const onHangup = () => {
  if (currentCall.value) {
    wazoService.hangup(currentCall.value)
  }
}

const onAccept = () => {
  if (currentCall.value) {
    wazoService.accept(currentCall.value)
  }
}

const onReject = () => {
  if (currentCall.value) {
    wazoService.reject(currentCall.value)
  }
}

const onToggleMute = () => {
  if (currentCall.value) {
    wazoService.mute(currentCall.value)
  }
}

const onToggleHold = () => {
  if (currentCall.value) {
    wazoService.hold(currentCall.value)
  }
}

const onDial = (extension) => {
  if (!extension) return

  wazoService
    .makeCall(extension)
    .then((call) => {
      currentCall.value = call
      hasActiveCall.value = true
      showToast(`Đang gọi: ${extension}`, 'success')
    })
    .catch((err) => {
      showToast('Lỗi gọi đi: ' + err.message, 'error')
    })
}

// --- Helper: Toast Notification ---
const showToast = (message, type = 'info') => {
  toastMessage.value = message
  toastType.value = type
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMessage.value = ''
  }, 4000)
}
</script>

<style scoped>
/* Layout cơ bản */
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f4f6f8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Header Styling */
.app-header {
  background-color: #2c3e50;
  color: white;
  padding: 0 24px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.25rem;
  font-weight: 700;
}

.logo-icon {
  font-size: 1.5rem;
}

.main-nav {
  display: flex;
  gap: 20px;
}

.nav-item {
  color: #ecf0f1;
  text-decoration: none;
  font-weight: 500;
  padding: 8px 0;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.nav-item:hover {
  color: #3498db;
}

.nav-item.router-link-active {
  border-bottom-color: #3498db;
  color: #3498db;
}

.btn-logout {
  background: transparent;
  border: 1px solid #e74c3c;
  color: #e74c3c;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-logout:hover {
  background: #e74c3c;
  color: white;
}

/* Main Content */
.app-main {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  position: relative;
}

/* Toast Notification Animation */
.toast-notification {
  position: fixed;
  top: 80px;
  right: 24px;
  padding: 12px 24px;
  border-radius: 8px;
  color: white;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 2000;
  min-width: 250px;
}

.toast-notification.info {
  background-color: #3498db;
}
.toast-notification.success {
  background-color: #2ecc71;
}
.toast-notification.error {
  background-color: #e74c3c;
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
</style>