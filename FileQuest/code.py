
src				
assets			
components			
call		
CallControlPanel.vue	<template>
  <div
    class="call-panel"
    :class="{
      incoming: isIncoming,
      active: isActive,
      minimized: isMinimized,
    }"
  >
    <!-- Header Panel (Nhấp để thu nhỏ/mở rộng) -->
    <div class="panel-header" @click="toggleMinimize">
      <div class="status-indicator" :class="panelStatusClass"></div>
      <span class="panel-title">{{ panelTitle }}</span>
      <button class="btn-minimize" title="{{ isMinimized ? 'Mở rộng' : 'Thu nhỏ' }}">
        {{ isMinimized ? '▲' : '▼' }}
      </button>
    </div>

    <!-- Nội dung Panel (Ẩn khi thu nhỏ) -->
    <div v-show="!isMinimized" class="panel-body">
      <!-- Trạng thái 1: Chưa kết nối tổng đài -->
      <div v-if="phoneStatus === 'disconnected'" class="state disconnected">
        <div class="icon">⚠️</div>
        <p>Chưa kết nối Wazo Server</p>
        <small>Vui lòng kiểm tra mạng hoặc SSL</small>
      </div>

      <!-- Trạng thái 2: Đang kết nối -->
      <div v-else-if="phoneStatus === 'connecting'" class="state connecting">
        <div class="spinner"></div>
        <p>Đang kết nối đến tổng đài...</p>
      </div>

      <!-- Trạng thái 3: Đã kết nối, sẵn sàng gọi (Idle) -->
      <div v-else-if="!hasActiveCall" class="state idle">
        <div class="avatar idle-avatar">👤</div>
        <h3>Sẵn sàng gọi điện</h3>
        <p>Nhập số máy lẻ bên dưới để thực hiện cuộc gọi đi.</p>

        <div class="dialer-input">
          <input
            v-model="localExtension"
            placeholder="VD: 1002"
            type="tel"
            maxlength="6"
            @keyup.enter="makeCall"
            class="extension-input"
          />
          <button @click="makeCall" class="btn-call-action">Gọi</button>
        </div>
      </div>

      <!-- Trạng thái 4: Có cuộc gọi (Incoming hoặc Active) -->
      <div v-else class="state active-call">
        <!-- Thông tin cuộc gọi -->
        <div class="call-info">
          <div class="avatar call-avatar" :style="{ backgroundColor: getAvatarColor(callName) }">
            {{ getInitials(callName) }}
          </div>
          <div class="call-details">
            <h3>{{ callName }}</h3>
            <p class="duration">{{ duration }}s</p>
            <p class="direction">{{ directionLabel }}</p>
          </div>
        </div>

        <!-- Nút điều khiển -->
        <div class="controls">
          <!-- Nếu đang đổ chuông (Incoming) -->
          <template v-if="isIncoming">
            <button @click="$emit('reject')" class="btn btn-reject" title="Từ chối">
              ✖ Từ chối
            </button>
            <button @click="$emit('accept')" class="btn btn-accept" title="Nghe máy">
              📞 Nghe máy
            </button>
          </template>

          <!-- Nếu đang gọi/nói chuyện (Outgoing/Talking/Held) -->
          <template v-else>
            <div class="control-group">
              <button @click="$emit('mute')" :class="{ active: isMuted }" title="Bật/Tắt Mic">
                {{ isMuted ? '🔇' : '🎙️' }}
              </button>

              <button @click="$emit('hold')" :class="{ active: isHeld }" title="Giữ máy">
                {{ isHeld ? '▶️' : '⏸️' }}
              </button>
            </div>

            <button @click="$emit('hangup')" class="btn btn-hangup" title="Cúp máy">
              📵 Cúp máy
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  currentCall: Object,
  phoneStatus: String, // 'disconnected', 'connecting', 'connected', 'error'
})

const emit = defineEmits(['hangup', 'accept', 'reject', 'mute', 'hold', 'dial'])

// State cho bàn phím quay số
const localExtension = ref('')

// State cho việc thu nhỏ panel
const isMinimized = ref(false)

// --- Computed Properties ---

const hasActiveCall = computed(() => !!props.currentCall)
const isIncoming = computed(() => props.currentCall?.state === 'incoming')
const isActive = computed(() =>
  ['ringing', 'progressing', 'talking', 'held'].includes(props.currentCall?.state),
)

// Trạng thái hiển thị trên header
const panelStatusClass = computed(() => {
  if (!hasActiveCall.value && !isActive.value) return 'idle'
  if (isIncoming.value) return 'ringing'
  if (isHeld.value) return 'held'
  return 'talking'
})

const panelTitle = computed(() => {
  if (props.phoneStatus === 'disconnected') return 'Wazo: Disconnected'
  if (props.phoneStatus === 'connecting') return 'Wazo: Connecting...'
  if (hasActiveCall.value) return 'Wazo: Active Call'
  return 'Wazo: Ready'
})

// Thông tin cuộc gọi
const callName = computed(() => {
  if (!props.currentCall) return ''
  // Ưu tiên remote_name, nếu không có thì lấy extension
  return props.currentCall.remote_name || props.currentCall.extension || 'Ẩn danh'
})

const directionLabel = computed(() => {
  if (!props.currentCall) return ''
  switch (props.currentCall.call_direction) {
    case 'inbound':
      return 'Cuộc gọi đến'
    case 'outbound':
      return 'Cuộc gọi đi'
    default:
      return ''
  }
})

const isMuted = computed(() => props.currentCall?.local_muted || false)
const isHeld = computed(() => props.currentCall?.local_held || false)

// Thời gian gọi
const duration = ref(0)
let timer = null

watch(
  () => props.currentCall,
  (newCall) => {
    if (newCall && ['talking', 'ringing', 'progressing'].includes(newCall.state)) {
      duration.value = 0
      timer = setInterval(() => {
        duration.value++
      }, 1000)
    } else {
      clearInterval(timer)
    }
  },
  { immediate: true },
)

// --- Methods ---

const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value
}

const makeCall = () => {
  if (localExtension.value.trim()) {
    emit('dial', localExtension.value.trim())
    localExtension.value = '' // Reset sau khi gọi
  }
}

// Helper UI
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 70%, 60%)`
}
</script>

<style scoped>
/* Container chính */
.call-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 320px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  z-index: 1000;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}

.call-panel.minimized {
  width: auto;
  min-width: 150px;
}

/* Header Panel */
.panel-header {
  background: #f8f9fa;
  padding: 10px 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
  user-select: none;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.idle {
  background: #bdc3c7;
}
.ringing {
  background: #e74c3c;
  animation: blink 1s infinite;
}
.talking {
  background: #2ecc71;
}
.held {
  background: #f39c12;
}

@keyframes blink {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
  100% {
    opacity: 1;
  }
}

.panel-title {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 600;
  color: #2c3e50;
}

.btn-minimize {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  color: #7f8c8d;
}

/* Body Panel */
.panel-body {
  padding: 20px;
  text-align: center;
}

/* Các trạng thái chung */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.icon {
  font-size: 2rem;
  margin-bottom: 5px;
}
p {
  color: #7f8c8d;
  font-size: 0.9rem;
  margin: 0;
}
small {
  color: #95a5a6;
  font-size: 0.8rem;
}

/* Spinner */
.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 10px 0;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* Avatar */
.avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  margin-bottom: 10px;
  color: white;
  font-weight: bold;
}

.idle-avatar {
  background: #3498db;
}
.call-avatar {
  font-size: 1.2rem;
}

/* Dialer Input */
.dialer-input {
  display: flex;
  gap: 5px;
  width: 100%;
  margin-top: 10px;
}

.extension-input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  text-align: center;
}

.extension-input:focus {
  outline: none;
  border-color: #3498db;
}

.btn-call-action {
  background: #2ecc71;
  color: white;
  border: none;
  padding: 10px 15px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.btn-call-action:hover {
  background: #27ae60;
}

/* Controls */
.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin-top: 15px;
}

.control-group {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.btn {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.2s;
}

.btn-accept {
  background: #2ecc71;
  color: white;
}
.btn-accept:hover {
  background: #27ae60;
}

.btn-reject {
  background: #e74c3c;
  color: white;
}
.btn-reject:hover {
  background: #c0392b;
}

.btn-hangup {
  background: #e74c3c;
  color: white;
}
.btn-hangup:hover {
  background: #c0392b;
}

.btn.active {
  background: #f39c12;
  color: white;
}

/* Call Info Layout */
.call-info {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 10px;
  text-align: left;
}

.call-details h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #2c3e50;
}

.duration {
  margin: 5px 0 0;
  color: #2ecc71;
  font-weight: bold;
  font-size: 1rem;
}

.direction {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: #7f8c8d;
}
</style>
layout		
Navbar.vue	<template>
  <nav class="navbar" :class="{ mobile: isMobile }">
    <!-- Logo & Brand -->
    <div class="navbar-brand" @click="goHome">
      <div class="logo-icon">📞</div>
      <span class="brand-text">SDV Wazo Web</span>
    </div>

    <!-- Menu Items -->
    <ul class="nav-menu">
      <li v-for="item in navItems" :key="item.path" class="nav-item">
        <router-link :to="item.path" class="nav-link" active-class="active">
          <span class="icon">{{ item.icon }}</span>
          <span class="text">{{ item.label }}</span>
        </router-link>
      </li>
    </ul>

    <!-- User Actions (Logout) -->
    <div class="nav-actions">
      <button @click="$emit('logout')" class="btn-logout">
        <span class="icon">🚪</span>
        <span class="text">Đăng xuất</span>
      </button>
    </div>

    <!-- Mobile Toggle Button (Optional, nếu cần menu hamburger) -->
    <button class="mobile-toggle" @click="toggleMenu" v-if="isMobile">☰</button>
  </nav>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// Định nghĩa các mục menu
const navItems = [
  { path: '/dashboard', label: 'Tổng quan', icon: '📊' },
  { path: '/contacts', label: 'Danh bạ', icon: '📇' },
  { path: '/history', label: 'Lịch sử', icon: '🕒' },
]

// State responsive
const isMobile = ref(false)
const isMenuOpen = ref(false)

// Check screen size
const checkMobile = () => {
  isMobile.value = window.innerWidth <= 768
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})

// Methods
const goHome = () => {
  router.push('/dashboard')
}

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value
}
</script>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #2c3e50;
  color: white;
  padding: 0 24px;
  height: 64px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  position: relative;
  z-index: 100;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 1.2rem;
  font-weight: 700;
  transition: opacity 0.2s;
}

.navbar-brand:hover {
  opacity: 0.9;
}

.logo-icon {
  font-size: 1.5rem;
}

.nav-menu {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 5px;
}

.nav-item {
  height: 100%;
}

.nav-link {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ecf0f1;
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 6px;
  transition: all 0.2s;
  font-weight: 500;
}

.nav-link:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #3498db;
}

/* Active state handled by router-link-active class */
.nav-link.router-link-active {
  background-color: rgba(52, 152, 219, 0.2);
  color: #3498db;
  border-bottom: 2px solid #3498db;
}

.nav-actions {
  display: flex;
  align-items: center;
}

.btn-logout {
  background: transparent;
  border: 1px solid #e74c3c;
  color: #e74c3c;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.btn-logout:hover {
  background: #e74c3c;
  color: white;
}

.mobile-toggle {
  display: none;
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
}

/* Responsive Styles */
@media (max-width: 768px) {
  .navbar {
    padding: 0 16px;
  }

  .mobile-toggle {
    display: block;
  }

  .nav-menu {
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    background-color: #34495e;
    flex-direction: column;
    padding: 10px 0;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    display: none; /* Hidden by default on mobile */
  }

  .nav-menu.open {
    display: flex;
  }

  .nav-item {
    width: 100%;
  }

  .nav-link {
    padding: 12px 20px;
    justify-content: flex-start;
  }

  .nav-actions {
    display: none; /* Hide logout button on mobile header, maybe move to menu or keep separate */
  }

  /* Optional: Show logout in mobile menu if needed */
}
</style>
router		
index.js	import { createRouter, createWebHistory } from 'vue-router'
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
services		
wazo.js	import Wazo from '@wazo/sdk'

class WazoService {
  constructor() {
    this.session = null
    // Thay IP này bằng IP server Wazo của LAN nội bộ SDV
    this.host = '192.168.1.50:9443'
    this.clientId = 'sdv-webapp-vue'
  }

  init() {
    Wazo.Auth.init(this.clientId)
    Wazo.Auth.setHost(this.host)
  }

  async login(username, password) {
    this.init()
    try {
      this.session = await Wazo.Auth.logIn(username, password)
      return true
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  logout() {
    if (this.session) {
      Wazo.Auth.logout(this.session)
      this.session = null
    }
    this.disconnectPhone()
  }

  isLogged() {
    return (!!this.session && !!this.session.token) || true
  }

  getToken() {
    return this.session?.token || ''
  }

  async connectPhone() {
    if (!this.isLogged()) throw new Error('User must be logged in')

    try {
      // Audio: true cần thiết cho WebRTC
      await Wazo.Phone.connect({ audio: true, video: false })
      this.attachListeners()
      return true
    } catch (error) {
      console.error('Phone connection failed:', error)
      throw error
    }
  }

  disconnectPhone() {
    try {
      Wazo.Phone.disconnect()
    } catch (e) {
      /* Ignore */
    }
  }

  attachListeners() {
    // Lắng nghe sự kiện từ SDK và phát ra event toàn cục qua window
    Wazo.Phone.on(Wazo.Phone.ON_CALL_INCOMING, (callSession) => {
      window.dispatchEvent(new CustomEvent('wazo-incoming', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ENDED, (callSession) => {
      window.dispatchEvent(new CustomEvent('wazo-ended', { detail: callSession }))
    })

    Wazo.Phone.on(Wazo.Phone.ON_CALL_ACCEPTED, (callSession) => {
      window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
    })
  }

  // Các hàm điều khiển cuộc gọi
  makeCall(extension) {
    return Wazo.Phone.call(extension)
  }

  hangup(callSession) {
    if (callSession) Wazo.Phone.hangup(callSession)
  }

  accept(callSession) {
    if (callSession) Wazo.Phone.accept(callSession)
  }

  reject(callSession) {
    if (callSession) Wazo.Phone.reject(callSession)
  }

  mute(callSession) {
    if (callSession) Wazo.Phone.mute(callSession)
  }

  hold(callSession) {
    if (callSession) Wazo.Phone.hold(callSession)
  }
}

export const wazoService = new WazoService()
views		
ContactsView.vue	<template>
  <div class="contacts-container">
    <!-- Header -->
    <div class="header">
      <h1>Danh bạ liên hệ</h1>
      <div class="search-wrapper">
        <input
          v-model="searchTerm"
          @input="debounceSearch"
          placeholder="🔍 Tìm kiếm tên hoặc số máy..."
          class="search-input"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && contacts.length === 0" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải danh bạ...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="state-message error">
      <p>{{ error }}</p>
      <button @click="loadContacts" class="btn-retry">Thử lại</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading && filteredContacts.length === 0" class="state-message empty">
      <p>Không tìm thấy liên hệ nào phù hợp.</p>
    </div>

    <!-- Contact List -->
    <div v-else class="contact-list">
      <div
        v-for="contact in filteredContacts"
        :key="contact.id || contact.uuid"
        class="contact-item"
      >
        <!-- Avatar với Initials -->
        <div class="avatar" :style="{ backgroundColor: getAvatarColor(contact.name) }">
          {{ getInitials(contact.name) }}
        </div>

        <!-- Thông tin -->
        <div class="contact-info">
          <div class="name">{{ contact.name || 'Ẩn danh' }}</div>
          <div class="details">
            <span class="extension">📞 {{ contact.number }}</span>
            <span v-if="contact.status" class="status-dot" :class="contact.statusClass"></span>
          </div>
        </div>

        <!-- Action Button -->
        <button @click="makeCall(contact.number)" class="btn-call" title="Gọi ngay">Gọi</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { wazoService } from '@/services/wazo'

// State
const searchTerm = ref('')
const contacts = ref([])
const loading = ref(false)
const error = ref('')

// Tính toán danh sách sau khi lọc
const filteredContacts = computed(() => {
  if (!searchTerm.value) return contacts.value

  const term = searchTerm.value.toLowerCase()
  return contacts.value.filter(
    (c) => (c.name && c.name.toLowerCase().includes(term)) || (c.number && c.number.includes(term)),
  )
})

// Lifecycle
onMounted(() => {
  loadContacts()
})

// Methods
const loadContacts = async () => {
  loading.value = true
  error.value = ''

  try {
    // 1. Lấy Source UUID của danh bạ nội bộ (Backend: wazo)
    // GET /api/dird/0.1/directories/default/sources?backend=wazo
    const token = wazoService.getToken()
    const host = wazoService.host // Ví dụ: 192.168.1.50:9443

    // Lưu ý: Cần thêm tiền tố https:// cho fetch nếu host không có
    const baseUrl = wazoService.host.startsWith('http')
      ? wazoService.host
      : `https://${wazoService.host}`

    const sourceRes = await fetch(
      `${baseUrl}/api/dird/0.1/directories/default/sources?backend=wazo`,
      {
        headers: { 'X-Auth-Token': token },
      },
    )

    if (!sourceRes.ok) throw new Error('Không thể lấy nguồn danh bạ')

    const sourcesData = await sourceRes.json()
    if (!sourcesData.items || sourcesData.items.length === 0) {
      contacts.value = []
      return
    }

    const sourceUuid = sourcesData.items[0].uuid

    // 2. Lấy Contacts từ Source đó
    // GET /api/dird/0.1/backends/wazo/sources/{uuid}/contacts
    const contactsRes = await fetch(
      `${baseUrl}/api/dird/0.1/backends/wazo/sources/${sourceUuid}/contacts?limit=1000`,
      {
        headers: { 'X-Auth-Token': token },
      },
    )

    if (!contactsRes.ok) throw new Error('Không thể tải danh sách liên hệ')

    const contactsData = await contactsRes.json()

    // Chuyển đổi dữ liệu API sang format UI đơn giản
    contacts.value = contactsData.items.map((item) => ({
      id: item.uuid,
      name: item.name,
      number: item.number, // Hoặc item.phone_number tùy schema
      status: null, // Có thể fetch presence sau này nếu cần
    }))
  } catch (err) {
    console.error('Lỗi tải danh bạ:', err)
    error.value = 'Không thể kết nối đến server Wazo để tải danh bạ.'
  } finally {
    loading.value = false
  }
}

// Debounce search để tránh gọi filter quá nhiều lần khi gõ nhanh
let debounceTimer
const debounceSearch = () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    // Logic filter đã được xử lý bởi Computed Property nên ở đây chỉ cần đảm bảo timing
  }, 300)
}

const makeCall = (extension) => {
  // Gửi sự kiện lên App.vue để mở panel gọi điện
  window.dispatchEvent(
    new CustomEvent('app-action', {
      detail: { type: 'dial', value: extension },
    }),
  )
}

// Helper functions cho UI
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  // Tạo màu ngẫu nhiên ổn định dựa trên tên
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 70%, 60%)`
}
</script>

<style scoped>
.contacts-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 15px;
}

.header h1 {
  color: #2c3e50;
  margin: 0;
  font-size: 1.5rem;
}

.search-wrapper {
  flex: 1;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: 10px 15px;
  border: 1px solid #ddd;
  border-radius: 25px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.search-input:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 5px rgba(52, 152, 219, 0.3);
}

.contact-list {
  display: grid;
  gap: 10px;
}

.contact-item {
  display: flex;
  align-items: center;
  background: white;
  padding: 12px 15px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.contact-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.avatar {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 1.1rem;
  margin-right: 15px;
  flex-shrink: 0;
}

.contact-info {
  flex: 1;
  min-width: 0; /* Cho phép text truncate */
}

.name {
  font-weight: 600;
  color: #2c3e50;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.details {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #7f8c8d;
  font-size: 0.9rem;
  margin-top: 4px;
}

.btn-call {
  background: #2ecc71;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
  margin-left: 15px;
}

.btn-call:hover {
  background: #27ae60;
}

/* States */
.state-message {
  text-align: center;
  padding: 40px 20px;
  color: #7f8c8d;
}

.state-message.error {
  color: #e74c3c;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin: 0 auto 10px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.btn-retry {
  margin-top: 10px;
  padding: 8px 15px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

/* Responsive */
@media (max-width: 600px) {
  .header {
    flex-direction: column;
    align-items: stretch;
  }

  .contact-item {
    flex-wrap: wrap;
  }

  .btn-call {
    width: 100%;
    margin-left: 0;
    margin-top: 10px;
  }
}
</style>
DashboardView.vue	<template>
  <div class="dashboard">
    <h1>Tổng quan hệ thống</h1>

    <div class="card">
      <h2>Thông tin người dùng</h2>
      <p><strong>Tên:</strong> {{ userInfo.firstname }} {{ userInfo.lastname }}</p>
      <p><strong>Máy lẻ:</strong> {{ primaryExtension }}</p>
      <p><strong>UUID:</strong> {{ userInfo.uuid }}</p>
    </div>

    <div class="card">
      <h2>Trạng thái hệ thống</h2>
      <ul>
        <li :class="{ 'status-ok': wazoService.isLogged(), 'status-err': !wazoService.isLogged() }">
          Xác thực: {{ wazoService.isLogged() ? 'Thành công' : 'Thất bại' }}
        </li>
        <li>SDK Version: @wazo/sdk (đã cài đặt)</li>
      </ul>
    </div>

    <div class="actions">
      <button @click="refreshData" class="btn-primary">Làm mới dữ liệu</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { wazoService } from '@/services/wazo'

const userInfo = ref({})
const primaryExtension = ref('')

onMounted(() => {
  refreshData()
})

const refreshData = async () => {
  if (!wazoService.isLogged()) return

  try {
    // Lấy thông tin user hiện tại qua REST API
    const token = wazoService.getToken()
    const host = wazoService.host.replace(/https?:\/\//, '') // Đảm bảo host đúng format cho fetch nếu cần

    // Lưu ý: Trong thực tế nên dùng axios/fetch wrapper có header Authorization tự động
    // Ở đây mình giả lập việc lấy data từ API confd
    // GET /api/confd/1.1/users/me

    // Để demo đơn giản, ta lấy metadata từ session nếu có, hoặc call API
    // Vì wazoService.session chứa metadata, ta dùng luôn cho nhanh
    if (wazoService.session && wazoService.session.metadata) {
      // Mock data vì SDK trả về uuid, cần call API mới ra tên đầy đủ
      // Trong app thật: await fetch(`https://${host}/api/confd/1.1/users/${wazoService.session.metadata.uuid}`, { headers: { 'X-Auth-Token': token } })

      // Giả lập response để UI đẹp hơn
      userInfo.value = {
        uuid: wazoService.session.metadata.uuid,
        firstname: 'Lê Việt',
        lastname: 'Dũng',
        username: 'vdung.le',
      }
      primaryExtension.value = '1001' // Giả lập máy lẻ đầu tiên
    }
  } catch (error) {
    console.error('Lỗi tải dashboard:', error)
  }
}
</script>

<style scoped>
.dashboard {
  max-width: 800px;
  margin: 0 auto;
}
.card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
}
h2 {
  margin-top: 0;
  color: #2c3e50;
}
.status-ok {
  color: green;
  font-weight: bold;
}
.status-err {
  color: red;
  font-weight: bold;
}
.btn-primary {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
}
</style>
HistoryView.vue	<template>
  <div class="history-container">
    <h1>Lịch sử cuộc gọi</h1>

    <!-- Bộ lọc -->
    <div class="filters">
      <div class="filter-group">
        <label for="direction-filter">Hướng:</label>
        <select id="direction-filter" v-model="filterDirection" @change="applyFilters">
          <option value="all">Tất cả</option>
          <option value="inbound">Đến (Inbound)</option>
          <option value="outbound">Đi (Outbound)</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="date-filter">Từ ngày:</label>
        <input type="date" id="date-filter" v-model="startDate" @change="applyFilters" />
      </div>

      <button @click="loadHistoryData" class="btn-refresh">🔄 Làm mới dữ liệu</button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải lịch sử cuộc gọi...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="state-message error">
      <p>{{ error }}</p>
      <button @click="loadHistoryData" class="btn-retry">Thử lại</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredCalls.length === 0 && !loading" class="state-message empty">
      <p>Không có cuộc gọi nào phù hợp với bộ lọc.</p>
    </div>

    <!-- Responsive Call List (Thay thế Table) -->
    <div v-else class="call-list-wrapper">
      <div v-for="call in filteredCalls" :key="call.uuid" class="call-card">
        <!-- Header của Card: Thời gian & Hướng -->
        <div class="card-header">
          <span class="time-text">{{ formatTime(call.start_time) }}</span>
          <span :class="['badge', call.direction]">
            {{ getDirectionLabel(call.direction) }}
          </span>
        </div>

        <!-- Body của Card: Thông tin chính -->
        <div class="card-body">
          <div class="info-row">
            <div class="info-item">
              <span class="label">Đối tượng:</span>
              <span class="value name">{{ call.remote_name || 'Ẩn danh' }}</span>
            </div>
            <div class="info-item">
              <span class="label">Số máy:</span>
              <span class="value number">{{ call.extension || call.remote_number || '-' }}</span>
            </div>
          </div>

          <div class="info-row bottom-row">
            <div class="info-item">
              <span class="label">Thời lượng:</span>
              <span class="value duration">{{ formatDuration(call.duration) }}</span>
            </div>
            <div class="info-item status-item">
              <span :class="['status-dot', call.answered ? 'answered' : 'missed']"></span>
              <span class="value status-text">{{ call.answered ? 'Đã nghe' : 'Nhỡ' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const filterDirection = ref('all')
const startDate = ref('')
const loading = ref(false)
const error = ref('')

// Mock Data giả lập từ API Call Log
const rawCalls = ref([
  {
    uuid: 'cdr-001',
    start_time: new Date().toISOString(),
    remote_name: 'Alice Nguyễn',
    extension: '1001',
    direction: 'inbound',
    duration: 125,
    answered: true,
  },
  {
    uuid: 'cdr-002',
    start_time: new Date(Date.now() - 3600000).toISOString(),
    remote_name: null,
    extension: '1002',
    direction: 'outbound',
    duration: 45,
    answered: true,
  },
  {
    uuid: 'cdr-003',
    start_time: new Date(Date.now() - 7200000).toISOString(),
    remote_name: 'Bob Trần',
    extension: '1003',
    direction: 'inbound',
    duration: 0,
    answered: false,
  },
  {
    uuid: 'cdr-004',
    start_time: new Date(Date.now() - 86400000).toISOString(),
    remote_name: 'Carol Lê',
    extension: '1004',
    direction: 'outbound',
    duration: 300,
    answered: true,
  },
])

const filteredCalls = computed(() => {
  let result = rawCalls.value

  if (filterDirection.value !== 'all') {
    result = result.filter((c) => c.direction === filterDirection.value)
  }

  if (startDate.value) {
    const start = new Date(startDate.value)
    start.setHours(0, 0, 0, 0)

    result = result.filter((c) => {
      const callDate = new Date(c.start_time)
      return callDate >= start
    })
  }

  return result.sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
})

onMounted(() => {
  loadHistoryData()
})

const loadHistoryData = async () => {
  loading.value = true
  error.value = ''

  try {
    await new Promise((resolve) => setTimeout(resolve, 500))
    console.log('Đã tải lịch sử cuộc gọi')
  } catch (err) {
    console.error('Lỗi tải lịch sử:', err)
    error.value = 'Không thể tải lịch sử cuộc gọi từ server.'
  } finally {
    loading.value = false
  }
}

const applyFilters = () => {
  // Computed property tự động cập nhật
}

const formatTime = (isoString) => {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatDuration = (seconds) => {
  if (!seconds || seconds === 0) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

const getDirectionLabel = (dir) => {
  switch (dir) {
    case 'inbound':
      return 'Đến'
    case 'outbound':
      return 'Đi'
    default:
      return dir
  }
}
</script>

<style scoped>
/* --- Container chung --- */
.history-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #333;
}

h1 {
  color: #2c3e50;
  margin-bottom: 20px;
  font-size: 1.5rem;
}

/* --- Filters --- */
.filters {
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap; /* Cho phép xuống dòng trên mobile */
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group label {
  font-weight: 500;
  color: #34495e;
  white-space: nowrap;
}

select,
input[type='date'] {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
  background-color: #fff;
}

.btn-refresh {
  background: #3498db;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
  margin-left: auto; /* Đẩy nút về cuối nếu có chỗ */
}

.btn-refresh:hover {
  background: #2980b9;
}

/* --- Call List (Responsive替代Table) --- */
.call-list-wrapper {
  display: grid;
  gap: 15px;
  /* Desktop: Có thể chia cột nếu muốn, nhưng list dọc thường dễ đọc hơn với nhiều dữ liệu */
  grid-template-columns: 1fr;
}

.call-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  border-left: 4px solid transparent; /* Dấu hiệu màu sắc bên trái */
}

.call-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

/* Thêm màu viền trái dựa trên hướng */
.call-card.inbound {
  border-left-color: #2ecc71;
}
.call-card.outbound {
  border-left-color: #3498db;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background-color: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.time-text {
  font-weight: 600;
  color: #2c3e50;
  font-size: 0.95rem;
}

.badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge.inbound {
  background-color: #2ecc71;
}

.badge.outbound {
  background-color: #3498db;
}

.card-body {
  padding: 15px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  font-size: 0.85rem;
  color: #7f8c8d;
  font-weight: 500;
}

.value {
  font-size: 0.95rem;
  color: #2c3e50;
  font-weight: 500;
}

.value.name {
  font-weight: 600;
}

.value.number {
  font-family: monospace; /* Giúp số dễ đọc hơn */
}

.bottom-row {
  align-items: center;
}

.status-item {
  margin-left: auto; /* Đẩy trạng thái về bên phải */
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.answered {
  background-color: #2ecc71;
  box-shadow: 0 0 4px rgba(46, 204, 113, 0.4);
}

.status-dot.missed {
  background-color: #e74c3c;
  box-shadow: 0 0 4px rgba(231, 76, 60, 0.4);
}

.status-text {
  font-size: 0.85rem;
  font-weight: 600;
}

.status-text.answered {
  color: #27ae60;
}
.status-text.missed {
  color: #c0392b;
}

/* --- States (Loading, Error, Empty) --- */
.state-message {
  text-align: center;
  padding: 40px;
  color: #7f8c8d;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.state-message.error {
  color: #e74c3c;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin: 0 auto 10px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.btn-retry {
  margin-top: 10px;
  padding: 8px 15px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

/* --- RESPONSIVE BREAKPOINTS --- */

/* Tablet và Mobile (< 768px) */
@media (max-width: 768px) {
  .history-container {
    padding: 15px;
  }

  h1 {
    font-size: 1.25rem;
  }

  .filters {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .filter-group {
    width: 100%;
  }

  select,
  input[type='‘date’'] {
    width: 100%;
  }

  .btn-refresh {
    width: 100%;
    margin-left: 0;
    text-align: center;
  }

  /* Điều chỉnh card trên mobile cho dễ nhìn */
  .card-body {
    padding: 12px;
  }

  .info-row {
    flex-direction: column;
    gap: 5px;
  }

  .bottom-row {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed #eee;
  }

  .status-item {
    margin-left: 0;
    justify-content: flex-start;
  }
}

/* Màn hình rất nhỏ (< 480px) */
@media (max-width: 480px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .badge {
    align-self: flex-start;
  }
}
</style>
LoginView.vue	<template>
  <div class="smart-call-login">
    <!-- Header giống hình: Nền tối, Logo bên trái -->
    <header class="top-bar">
      <div class="logo-area">
        <svg
          class="icon-logo"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="#1e88e5"
          stroke="white"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
          ></path>
        </svg>
        <span class="app-name">SmartCall</span>
      </div>
    </header>

    <!-- Main Content: Centered như hình -->
    <main class="login-body">
      <div class="center-wrapper">
        <!-- Logo lớn ở giữa -->
        <div class="main-logo-container">
          <svg
            class="big-icon"
            xmlns="http://www.w3.org/2000/svg"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="#1e88e5"
            stroke="white"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            ></path>
          </svg>
        </div>

        <!-- Tiêu đề -->
        <h1 class="title">SmartCall</h1>

        <!-- Form Login -->
        <form @submit.prevent="handleLogin" class="login-form">
          <div class="input-group">
            <input type="text" v-model="username" placeholder="" required autocomplete="off" />
          </div>

          <div class="input-group">
            <input
              :type="showPassword ? 'text' : 'password'"
              v-model="password"
              placeholder="PASSWORD"
              required
            />
            <button type="button" class="toggle-eye" @click="showPassword = !showPassword"></button>
          </div>

          <button type="submit" class="btn-submit">LOGIN</button>

          <div class="remember-me">
            <label>
              <input type="checkbox" v-model="rememberMe" />
              Remember me
            </label>
          </div>
        </form>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(false)

const handleLogin = () => {
  console.log('Đăng nhập:', { username: username.value, password: password.value })
  // Logic đăng nhập tại đây
}
</script>

<style scoped>
/* --- Reset & Base --- */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.smart-call-login {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background-color: #e3ebf0; /* Màu nền xám nhạt giống hình */
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* --- Top Bar (Header) --- */
.top-bar {
  background-color: #23272b; /* Nền tối giống hình */
  color: white;
  height: 50px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #3a3f45;
}

.logo-area {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.2rem;
  font-weight: bold;
  color: #1e88e5; /* Chữ xanh dương */
}

.icon-logo {
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.5));
}

/* --- Main Body --- */
.login-body {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

.center-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 400px;
}

/* --- Logo & Title --- */
.main-logo-container {
  margin-bottom: 10px;
}

.big-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.title {
  color: #1e88e5;
  font-size: 1.8rem;
  font-weight: 600;
  margin-bottom: 30px;
  letter-spacing: -0.5px;
}

/* --- Form --- */
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-group {
  position: relative;
  width: 100%;
}

.input-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ccc; /* Viền xám nhẹ */
  border-radius: 2px; /* Bo góc rất nhỏ hoặc không bo như hình gốc */
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.input-group input:focus {
  border-color: #1e88e5;
}

/* Placeholder styling để giống hình (không có label nổi) */
.input-group input::placeholder {
  color: transparent; /* Ẩn placeholder mặc định nếu muốn */
}

.toggle-eye {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.5;
  font-size: 0.9rem;
}

.btn-submit {
  background-color: #1e88e5; /* Xanh dương đậm */
  color: white;
  border: none;
  padding: 10px;
  font-size: 0.9rem;
  font-weight: bold;
  text-transform: uppercase;
  cursor: pointer;
  border-radius: 2px;
  transition: background-color 0.2s;
}

.btn-submit:hover {
  background-color: #1565c0;
}

.remember-me {
  margin-top: 15px;
  display: flex;
  justify-content: center;
}

.remember-me label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #666;
  cursor: pointer;
}

.remember-me input {
  accent-color: #1e88e5;
}

/* --- Responsive Mobile --- */
@media (max-width: 600px) {
  .top-bar {
    padding: 0 15px;
  }

  .title {
    font-size: 1.5rem;
  }

  .login-form {
    max-width: 90%;
  }
}
</style>
App.vue		<template>
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
main.js		import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/main.css'

const app = createApp(App)

app.use(router)

app.mount('#app')
index.html			<!DOCTYPE html>
<html lang="">
  <head>
    <meta charset="UTF-8">
    <link rel="icon" href="/favicon.ico">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vite App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>