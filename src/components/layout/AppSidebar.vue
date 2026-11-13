<template>
  <aside class="app-sidebar">
    <ul class="sidebar-menu">
      <li v-if="features.dashboard">
        <router-link to="/dashboard" class="nav-btn" active-class="active">
          <span class="icon">📊</span>
          <span>Tổng quan</span>
        </router-link>
      </li>

      <li v-if="features.calls">
        <router-link to="/calls" class="nav-btn" active-class="active">
          <span class="icon">📞</span>
          <span>Gọi điện & Bàn phím</span>
        </router-link>
      </li>

      <li v-if="features.contacts">
        <router-link to="/contacts" class="nav-btn" active-class="active">
          <span class="icon">📇</span>
          <span>Danh bạ</span>
        </router-link>
      </li>

      <li v-if="features.messages">
        <router-link to="/messages" class="nav-btn" active-class="active">
          <span class="icon">💬</span>
          <span>Tin nhắn</span>
          <span v-if="unreadMessagesCount > 0" class="badge-count badge-danger" title="Tin nhắn chưa đọc">
            {{ unreadMessagesCount }}
          </span>
        </router-link>
      </li>

      <li v-if="features.history">
        <router-link to="/history" class="nav-btn" active-class="active">
          <span class="icon">🕒</span>
          <span>Lịch sử cuộc gọi</span>
        </router-link>
      </li>
    </ul>

    <div class="sidebar-footer">
      <div>SIP: <code>{{ userExt }}@107.126.11.126</code></div>
      <div class="webrtc-status" :class="{ 'status-online': isWebRtcReady, 'status-offline': !isWebRtcReady }">
        ● {{ isWebRtcReady ? 'WebRTC SIP Online' : 'WebRTC SIP Sẵn sàng' }}
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { contactService } from '@/services/contactService'
import { chatService } from '@/services/chatService'
import { historyService } from '@/services/historyService'
import { wazoService } from '@/services/wazo'
import { getFeatures } from '@/config/features'

const features = ref(getFeatures())
const userExt = ref(localStorage.getItem('smartcall_extension') || '1001')
const isWebRtcReady = ref(
  wazoService.isPhoneRegistered() ||
    (Boolean(localStorage.getItem('smartcall_wazo_token')) && localStorage.getItem('smartcall_offline_mode') !== 'true')
)

const onFeaturesChanged = (e) => {
  features.value = e.detail || getFeatures()
}

const contactsCount = ref(0)
const unreadMessagesCount = ref(0)
const missedCallsCount = ref(0)

const handleRegistered = () => {
  isWebRtcReady.value = true
}

const handleUnregistered = () => {
  isWebRtcReady.value = false
}

const updateSidebarCounts = async () => {
  userExt.value = localStorage.getItem('smartcall_extension') || '1001'
  const isOffline = localStorage.getItem('smartcall_offline_mode') === 'true'
  const hasToken = Boolean(localStorage.getItem('smartcall_wazo_token'))
  isWebRtcReady.value = wazoService.isPhoneRegistered() || (hasToken && !isOffline)

  // 1. Thống kê tổng số danh bạ
  try {
    const contacts = await contactService.getContacts()
    if (Array.isArray(contacts)) {
      contactsCount.value = contacts.length
    }
  } catch (e) {
    /* ignore */
  }

  // 2. Thống kê tin nhắn chưa đọc
  try {
    const rooms = await chatService.getRooms()
    if (Array.isArray(rooms)) {
      unreadMessagesCount.value = rooms.reduce((acc, r) => acc + (r.unread || 0), 0)
    }
  } catch (e) {
    /* ignore */
  }

  // 3. Thống kê cuộc gọi nhỡ
  try {
    const history = await historyService.getHistory()
    if (Array.isArray(history)) {
      missedCallsCount.value = history.filter(
        (h) => h.status === 'missed' || h.status === 'declined' || !h.answered,
      ).length
    }
  } catch (e) {
    /* ignore */
  }
}

onMounted(() => {
  updateSidebarCounts()
  window.addEventListener('wazo-registered', handleRegistered)
  window.addEventListener('wazo-unregistered', handleUnregistered)
  window.addEventListener('app-login-success', updateSidebarCounts)
  window.addEventListener('smartcall-rooms-updated', updateSidebarCounts)
  window.addEventListener('smartcall-contacts-updated', updateSidebarCounts)
  window.addEventListener('smartcall-cdr-updated', updateSidebarCounts)
  window.addEventListener('smartcall-features-changed', onFeaturesChanged)
})

onUnmounted(() => {
  window.removeEventListener('wazo-registered', handleRegistered)
  window.removeEventListener('wazo-unregistered', handleUnregistered)
  window.removeEventListener('app-login-success', updateSidebarCounts)
  window.removeEventListener('smartcall-rooms-updated', updateSidebarCounts)
  window.removeEventListener('smartcall-contacts-updated', updateSidebarCounts)
  window.removeEventListener('smartcall-cdr-updated', updateSidebarCounts)
  window.removeEventListener('smartcall-features-changed', onFeaturesChanged)
})
</script>

<style scoped>
.app-sidebar {
  width: 220px;
  background: #262c34;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-right: 1px solid #1a1e24;
  user-select: none;
  height: 100%;
}

.sidebar-menu {
  list-style: none;
  padding: 15px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  margin: 0;
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  color: #94a3b8;
  border-radius: 8px;
  text-decoration: none;
  cursor: pointer;
  font-size: 0.92rem;
  font-weight: 500;
  transition: all 0.2s;
}

.nav-btn:hover {
  background: #323a45;
  color: white;
}

.nav-btn.active {
  background: #1e88e5;
  color: white;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(30, 136, 229, 0.4);
}

.nav-btn .icon {
  font-size: 1.15rem;
  width: 22px;
  text-align: center;
}

.badge-count {
  margin-left: auto;
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 10px;
  font-weight: 700;
  line-height: 1.2;
  transition: all 0.2s ease;
}

/* Badge Đỏ cho thông báo cần chú ý (Tin nhắn chưa đọc / Cuộc gọi nhỡ) */
.badge-count.badge-danger {
  background: #ef4444;
  color: #ffffff;
  box-shadow: 0 1px 4px rgba(239, 68, 68, 0.4);
  animation: pulse-badge 2s infinite;
}

/* Badge Trung tính cho tổng số liên hệ danh bạ */
.badge-count.badge-neutral {
  background: #334155;
  color: #94a3b8;
  border: 1px solid #475569;
}

@keyframes pulse-badge {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
}

.sidebar-footer {
  padding: 12px 15px;
  border-top: 1px solid #343a40;
  font-size: 0.75rem;
  color: #64748b;
  background: #20252c;
}

.sidebar-footer code {
  color: #cbd5e1;
  font-family: monospace;
}

.webrtc-status {
  margin-top: 4px;
  font-weight: 500;
  transition: color 0.3s;
}

.webrtc-status.status-online {
  color: #4ade80;
}

.webrtc-status.status-offline {
  color: #94a3b8;
}
</style>

