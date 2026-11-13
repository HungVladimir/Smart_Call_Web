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
            <component :is="Component" :key="$route.name" />
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

    <!-- 4. Modal Cuộc gọi đến WebRTC -->
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

    <!-- 7. Bảng Nhật ký Debug thao tác & Sự kiện WebRTC thời gian thực -->
    <DebugLogDrawer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { wazoService } from '@/services/wazo'
import { audioService } from '@/services/audioService'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import SettingsModal from '@/components/common/SettingsModal.vue'
import IncomingCallModal from '@/components/call/IncomingCallModal.vue'
import DebugLogDrawer from '@/components/common/DebugLogDrawer.vue'
import { historyService } from '@/services/historyService'
import { contactService } from '@/services/contactService'
import { isFeatureEnabled } from '@/config/features'

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

  // 2. Lắng nghe các sự kiện toàn cục
  window.addEventListener('app-action', handleAppAction)
  window.addEventListener('app-toast', handleToastEvent)
  window.addEventListener('app-login-success', handleLoginSuccess)
  window.addEventListener('wazo-incoming', handleIncomingCall)
  window.addEventListener('wazo-ended', handleCallEnded)
  window.addEventListener('wazo-registered', handleWazoRegistered)
})

onUnmounted(() => {
  window.removeEventListener('app-action', handleAppAction)
  window.removeEventListener('app-toast', handleToastEvent)
  window.removeEventListener('app-login-success', handleLoginSuccess)
  window.removeEventListener('wazo-incoming', handleIncomingCall)
  window.removeEventListener('wazo-ended', handleCallEnded)
  window.removeEventListener('wazo-registered', handleWazoRegistered)
  wazoService.disconnectPhone()
})

const handleWazoRegistered = () => {
  isPhoneConnected.value = true
  phoneStatus.value = 'connected'
  showToast('Tổng đài: Đã kích hoạt máy lẻ WebRTC!', 'success')
}

// --- Logic xử lý sự kiện ---
const handleLoginSuccess = () => {
  isLoggedIn.value = true
  tryConnectPhone()
}

const tryConnectPhone = async () => {
  if (localStorage.getItem('smartcall_offline_mode') === 'true') {
    phoneStatus.value = 'disconnected'
    isPhoneConnected.value = false
    return
  }
  phoneStatus.value = 'connecting'
  try {
    await wazoService.connectPhone()
    isPhoneConnected.value = true
    phoneStatus.value = 'connected'
    showToast('Tổng đài: Kết nối thoại sẵn sàng!', 'success')
  } catch (err) {
    phoneStatus.value = 'disconnected'
    isPhoneConnected.value = false
    console.info('Hệ thống khởi chạy ở chế độ ngoại tuyến dự phòng:', err.message)
  }
}

const handleIncomingCall = (event) => {
  const session = event.detail
  const ext = session?.number || session?.callerNumber || ''
  const name = session?.displayName || session?.realDisplayName || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp')

  // Nếu đang có cuộc gọi hoạt động (Đang đàm thoại hoặc đổ chuông) -> Tự động từ chối máy bận và ghi nhận cuộc gọi nhỡ
  if (hasActiveCall.value) {
    try {
      if (session) wazoService.reject(session)
    } catch (e) {
      /* ignore */
    }
    historyService.addRecord({
      name,
      extension: ext,
      dept: 'Nội bộ công ty',
      duration: 0,
      direction: 'inbound',
      status: 'missed',
      answered: false,
    })
    showToast(`📞 Cuộc gọi nhỡ từ ${name} (Máy bận)`, 'warning')
    return
  }

  incomingCallData.value = {
    rawSession: session,
    name,
    extension: ext,
    sipUri: ext ? `sip:${ext}@107.126.11.126` : '',
  }
  showIncomingModal.value = true
  currentCall.value = session
  hasActiveCall.value = true
}

const onAcceptIncomingCall = (callData) => {
  showIncomingModal.value = false
  if (callData?.rawSession || currentCall.value) {
    try {
      wazoService.accept(callData?.rawSession || currentCall.value)
    } catch (e) {
      console.log('Error accepting call:', e)
    }
  }
  showToast(`Đã nhận cuộc gọi từ ${callData?.name || callData?.extension || 'Đồng nghiệp'}!`, 'success')

  // Chuyển sang màn hình CallsView với cờ active=true (Đang đàm thoại, không quay số lại)
  router.push({
    path: '/calls',
    query: {
      number: callData?.extension || '1002',
      name: callData?.name || '',
      dept: callData?.dept || '',
      active: 'true',
      direction: 'inbound',
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

  const ext = callData?.extension || '1003'
  const contact = contactService.findContactByExtension(ext)
  const name = callData?.name || contact?.name || `Máy lẻ ${ext}`
  const dept = callData?.dept || contact?.dept || 'Khối Vận hành / Phân xưởng MFQ'

  historyService.addRecord({
    name,
    extension: ext,
    dept,
    duration: 0,
    direction: 'inbound',
    status: 'declined',
    answered: false,
  })

  showToast('Đã từ chối cuộc gọi.', 'info')
}

const onMissedIncomingCall = (callData) => {
  showIncomingModal.value = false
  currentCall.value = null
  hasActiveCall.value = false

  const ext = callData?.extension || '1003'
  const contact = contactService.findContactByExtension(ext)
  const name = callData?.name || contact?.name || `Máy lẻ ${ext}`
  const dept = callData?.dept || contact?.dept || 'Khối Vận hành / Phân xưởng MFQ'

  historyService.addRecord({
    name,
    extension: ext,
    dept,
    duration: 0,
    direction: 'inbound',
    status: 'missed',
    answered: false,
  })

  showToast(`Cuộc gọi nhỡ từ ${name}`, 'warning')
}

const handleCallEnded = () => {
  currentCall.value = null
  hasActiveCall.value = false
  audioService.stopAllTones()
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
  isPhoneConnected.value = false
  currentCall.value = null
  hasActiveCall.value = false
  router.push('/login')
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
      if (isFeatureEnabled('mockData') && !wazoService.session?.token) {
        currentCall.value = { extension, state: 'talking' }
        hasActiveCall.value = true
        showToast(`Đang kết nối cuộc gọi thử nghiệm tới: ${extension}`, 'info')
      } else {
        showToast(`Không thể kết nối cuộc gọi tới: ${extension}`, 'error')
      }
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
</style>
