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

      <!-- Nội dung chính của từng trang -->
      <main class="app-content">
        <router-view />
      </main>
    </div>

    <!-- Màn hình Login hiển thị toàn màn hình nếu chưa đăng nhập hoặc đang ở trang Login -->
    <div v-else class="login-fullscreen">
      <router-view />
    </div>

    <!-- 3. Modal Cài đặt hệ thống (Settings Modal) -->
    <SettingsModal :is-open="showSettings" @close="showSettings = false" />

    <!-- 4. Modal Cuộc gọi đến WebRTC -->
    <IncomingCallModal
      :is-open="showIncomingModal"
      :call-data="incomingCallData"
      @accept="onAcceptIncomingCall"
      @reject="onRejectIncomingCall"
    />

    <!-- 5. Panel Điều khiển Cuộc gọi nổi (Floating Widget góc phải) -->
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

    <!-- 6. Thông báo Toast nổi -->
    <transition name="slide-fade">
      <div v-if="toastMessage" class="toast-notification" :class="toastType">
        {{ toastMessage }}
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { wazoService } from '@/services/wazo'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import SettingsModal from '@/components/common/SettingsModal.vue'
import CallControlPanel from '@/components/call/CallControlPanel.vue'
import IncomingCallModal from '@/components/call/IncomingCallModal.vue'

const router = useRouter()
const route = useRoute()

// --- State Management ---
const isLoggedIn = ref(false)
const showSettings = ref(false)
const showIncomingModal = ref(false)
const incomingCallData = ref(null)
const isPhoneConnected = ref(false)
const phoneStatus = ref('disconnected')
const currentCall = ref(null)
const hasActiveCall = ref(false)

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
    tryConnectPhone()
  } else {
    isLoggedIn.value = false
    if (route.path !== '/login') {
      router.push('/login')
    }
  }

  // 2. Lắng nghe các sự kiện toàn cục
  window.addEventListener('app-action', handleAppAction)
  window.addEventListener('app-toast', handleToastEvent)
  window.addEventListener('app-login-success', handleLoginSuccess)
  window.addEventListener('wazo-incoming', handleIncomingCall)
  window.addEventListener('wazo-ended', handleCallEnded)
})

onUnmounted(() => {
  window.removeEventListener('app-action', handleAppAction)
  window.removeEventListener('app-toast', handleToastEvent)
  window.removeEventListener('app-login-success', handleLoginSuccess)
  window.removeEventListener('wazo-incoming', handleIncomingCall)
  window.removeEventListener('wazo-ended', handleCallEnded)
  wazoService.disconnectPhone()
})

// --- Logic xử lý sự kiện ---
const handleLoginSuccess = () => {
  isLoggedIn.value = true
  tryConnectPhone()
}

const tryConnectPhone = async () => {
  phoneStatus.value = 'connecting'
  try {
    await wazoService.connectPhone()
    isPhoneConnected.value = true
    phoneStatus.value = 'connected'
    showToast('Tổng đài Wazo: Đã kết nối WebRTC!', 'success')
  } catch (err) {
    phoneStatus.value = 'error'
    console.log('Chưa kết nối được Wazo LAN thực tế (Chế độ Demo):', err)
  }
}

const handleIncomingCall = (event) => {
  incomingCallData.value = event.detail
  showIncomingModal.value = true
  currentCall.value = event.detail
  hasActiveCall.value = true
}

const onAcceptIncomingCall = (callData) => {
  showIncomingModal.value = false
  if (wazoService.session && callData?.rawSession) {
    try {
      wazoService.accept(callData.rawSession)
    } catch (e) {
      /* ignore */
    }
  }
  showToast(`Đã nhận cuộc gọi từ ${callData.name || callData.extension || 'Đồng nghiệp'}!`, 'success')

  // Chuyển sang màn hình CallsView để hiển thị cuộc gọi đang đàm thoại
  router.push({
    path: '/calls',
    query: {
      number: callData.extension || '1007',
      autocall: 'true',
    },
  })
}

const onRejectIncomingCall = (callData) => {
  showIncomingModal.value = false
  if (wazoService.session && callData?.rawSession) {
    try {
      wazoService.reject(callData.rawSession)
    } catch (e) {
      /* ignore */
    }
  }
  currentCall.value = null
  hasActiveCall.value = false
  showToast('Đã từ chối cuộc gọi.', 'info')
}

const handleCallEnded = () => {
  currentCall.value = null
  hasActiveCall.value = false
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
  isLoggedIn.value = false
  isPhoneConnected.value = false
  currentCall.value = null
  hasActiveCall.value = false
  router.push('/login')
}

const onHangup = () => {
  if (currentCall.value) wazoService.hangup(currentCall.value)
  currentCall.value = null
  hasActiveCall.value = false
}

const onAccept = () => {
  if (currentCall.value) wazoService.accept(currentCall.value)
}

const onReject = () => {
  if (currentCall.value) wazoService.reject(currentCall.value)
  currentCall.value = null
  hasActiveCall.value = false
}

const onToggleMute = () => {
  if (currentCall.value) wazoService.mute(currentCall.value)
}

const onToggleHold = () => {
  if (currentCall.value) wazoService.hold(currentCall.value)
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
      // Mock call demo if offline
      currentCall.value = { extension, state: 'talking' }
      hasActiveCall.value = true
      showToast(`Đang kết nối cuộc gọi thoại tới: ${extension}`, 'info')
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
  color: white;
  font-weight: 500;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
  z-index: 9999;
  min-width: 250px;
  font-size: 0.9rem;
}

.toast-notification.info {
  background-color: #1e88e5;
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
