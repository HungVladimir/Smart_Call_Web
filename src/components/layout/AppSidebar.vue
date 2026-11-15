<template>
  <aside class="app-sidebar">
    <ul class="sidebar-menu">
      <li v-if="features.calls">
        <router-link to="/calls" class="nav-btn" active-class="active">
          <span class="icon">📞</span>
          <span>Gọi điện & Danh bạ</span>
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
      <div>SIP: <code>{{ userExt }}@{{ sipDomain }}</code></div>
      <div class="webrtc-status" :class="{ 'status-online': isWebRtcReady, 'status-offline': !isWebRtcReady }">
        ● {{ isWebRtcReady ? 'WebRTC SIP Online' : 'WebRTC SIP Sẵn sàng' }}
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { chatService } from '@/services/chatService'
import { wazoService, callStore } from '@/services/wazo'
import { getFeatures } from '@/config/features'

const features = ref(getFeatures())
const userExt = computed(() => callStore.myExtension || localStorage.getItem('smartcall_extension') || '1001')
const sipDomain = computed(() =>
  (wazoService.host || '107.126.11.126:9443').replace(/^https?:\/\//, '').split(':')[0],
)
const isWebRtcReady = computed(
  () =>
    callStore.isRegistered ||
    (Boolean(localStorage.getItem('smartcall_wazo_token')) && localStorage.getItem('smartcall_offline_mode') !== 'true'),
)

const onFeaturesChanged = (e) => {
  features.value = e.detail || getFeatures()
}

const unreadMessagesCount = ref(0)

let isUpdatingSidebar = false
let sidebarDebounceTimer = null

const updateSidebarCounts = async () => {
  if (isUpdatingSidebar) return
  isUpdatingSidebar = true

  try {
    // Thống kê tin nhắn chưa đọc (chỉ duy nhất tin nhắn hiển thị badge trên Sidebar theo Rule 3.4 GEMINI.md)
    try {
      const rooms = await chatService.getRooms()
      if (Array.isArray(rooms)) {
        unreadMessagesCount.value = rooms.reduce((acc, r) => acc + (r.unread || 0), 0)
      }
    } catch (e) {
      /* ignore */
    }
  } finally {
    isUpdatingSidebar = false
  }
}

const debouncedUpdateSidebarCounts = () => {
  if (sidebarDebounceTimer) clearTimeout(sidebarDebounceTimer)
  sidebarDebounceTimer = setTimeout(() => {
    updateSidebarCounts()
  }, 400)
}

onMounted(() => {
  debouncedUpdateSidebarCounts()
  window.addEventListener('app-login-success', debouncedUpdateSidebarCounts)
  window.addEventListener('smartcall-rooms-updated', debouncedUpdateSidebarCounts)
  window.addEventListener('smartcall-features-changed', onFeaturesChanged)
})

onUnmounted(() => {
  if (sidebarDebounceTimer) {
    clearTimeout(sidebarDebounceTimer)
    sidebarDebounceTimer = null
  }
  window.removeEventListener('app-login-success', debouncedUpdateSidebarCounts)
  window.removeEventListener('smartcall-rooms-updated', debouncedUpdateSidebarCounts)
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

@media (max-width: 768px) {
  .app-sidebar {
    width: 100%;
    height: 56px;
    flex-direction: row;
    border-right: none;
    border-top: 1px solid #1a1e24;
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.2);
    z-index: 100;
  }

  .sidebar-menu {
    flex-direction: row;
    padding: 4px 6px;
    align-items: center;
    justify-content: space-around;
    gap: 4px;
  }

  .nav-btn {
    padding: 6px 8px;
    font-size: 0.76rem;
    gap: 6px;
    flex: 1;
    justify-content: center;
  }

  .nav-btn .icon {
    font-size: 1rem;
    width: auto;
  }

  .badge-count {
    padding: 1px 5px;
    font-size: 0.65rem;
    margin-left: 2px;
  }

  .sidebar-footer {
    display: none;
  }
}
</style>

