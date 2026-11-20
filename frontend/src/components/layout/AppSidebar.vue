<template>
  <aside class="app-sidebar">
    <ul class="sidebar-menu">
      <li v-if="features.calls">
        <router-link to="/calls" class="nav-btn" active-class="active" @click="onCallsNavClick">
          <span class="icon">📞</span>
          <span>Gọi điện & Danh bạ</span>
        </router-link>
      </li>

      <li v-if="features.messages">
        <router-link
          to="/messages"
          class="nav-btn"
          active-class="active"
          @click="onMessagesNavClick"
        >
          <span class="icon">💬</span>
          <span>Tin nhắn</span>
          <span
            v-if="totalUnread > 0"
            class="unread-badge"
            :aria-label="`${totalUnread} tin nhắn chưa mở`"
            >{{ totalUnread }}</span
          >
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
      <div class="dev-credits">
        <div class="dept-line">AI Transformation Part</div>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { chatService } from '@/services/index.js'
import { getFeatures } from '@/config/features.js'

const features = ref(getFeatures())
/** Tổng badge lấy từ một nguồn state của ChatService. */
const totalUnread = computed(() => chatService.totalUnread)
/** Nhận cấu hình màn hình mới để Sidebar cập nhật danh sách mục điều hướng. */
const onFeaturesChanged = (e) => {
  const messagesWereEnabled = features.value.messages
  features.value = e.detail || getFeatures()
  if (!messagesWereEnabled && features.value.messages)
    chatService.restoreUnreadNotifications().catch(() => {})
}

/** Điều hướng tới màn hình gọi và phát yêu cầu cập nhật danh bạ theo luồng hiện tại. */
const onCallsNavClick = () => {
  window.dispatchEvent(new CustomEvent('smartcall-refresh-contacts'))
}

/** Mở màn hình tin nhắn qua router, giữ việc tải dữ liệu ở View/service. */
const onMessagesNavClick = () => {
  window.dispatchEvent(new CustomEvent('smartcall-refresh-rooms'))
}

// Khi component được gắn vào DOM, nạp dữ liệu và đăng ký các listener/tài nguyên cần cho giao diện
// này.
onMounted(() => {
  if (features.value.messages) chatService.restoreUnreadNotifications().catch(() => {})
  window.addEventListener('smartcall-features-changed', onFeaturesChanged)
})

// Khi component bị hủy, gỡ listener và dọn tài nguyên thuộc vòng đời này để callback cũ không tiếp
// tục tác động UI.
onUnmounted(() => {
  window.removeEventListener('smartcall-features-changed', onFeaturesChanged)
})
</script>

<style scoped>
.unread-badge {
  margin-left: auto;
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 12px;
  background: #ef4444;
  color: white;
  font-size: 0.75rem;
  text-align: center;
}

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

.sidebar-footer {
  padding: 10px 12px;
  border-top: 1px solid #1a1e24;
  font-size: 0.72rem;
  background: #1e232a;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dev-credits {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dev-line {
  color: #cbd5e1;
  font-weight: 500;
  font-size: 0.71rem;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dept-line {
  color: #38bdf8;
  font-size: 0.69rem;
  font-weight: 600;
  margin-top: 1px;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.webrtc-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.71rem;
  font-weight: 600;
  padding-top: 5px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  transition: color 0.3s;
}

.webrtc-status.status-online {
  color: #4ade80;
}

.webrtc-status.status-offline {
  color: #94a3b8;
}

.status-indicator-dot {
  font-size: 0.65rem;
  line-height: 1;
}

.status-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

  .sidebar-footer {
    display: none;
  }
}
</style>
