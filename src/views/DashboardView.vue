<template>
  <div class="dashboard-view">
    <!-- 1. Welcome Banner -->
    <div class="welcome-banner">
      <div class="banner-content">
        <div class="banner-avatar">
          <span>{{ userInitials }}</span>
        </div>
        <div class="banner-text">
          <h1>Xin chào, {{ userName }}! 👋</h1>
          <p class="sub-text">
            Hệ thống liên lạc SmartCall • Máy lẻ nội bộ:
            <strong>{{ userExtension }}</strong> • Trạng thái: Sẵn sàng kết nối
          </p>
        </div>
      </div>

      <div class="banner-actions">
        <!-- Nút Test mô phỏng cuộc gọi đến -->
        <button class="btn-test-call-banner" @click="simulateCall">
          🔔 Thử cuộc gọi đến
        </button>
      </div>
    </div>

    <!-- 2. Thẻ thống kê tổng quan (Top 4 KPI Cards) -->
    <div class="stat-grid">
      <!-- Thẻ 1: Máy lẻ WebRTC -->
      <div class="stat-card" @click="navigateTo('/calls')">
        <div class="stat-icon icon-blue">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z" />
          </svg>
        </div>
        <div class="stat-info">
          <h4>Máy lẻ WebRTC</h4>
          <p class="stat-number">{{ userExtension }}</p>
          <span class="stat-badge" :class="isPhoneConnected ? 'badge-green' : 'badge-amber'">
            {{ isPhoneConnected ? '● Sẵn sàng kết nối' : '⚪ Đang sẵn sàng' }}
          </span>
        </div>
      </div>

      <!-- Thẻ 2: Danh bạ nội bộ -->
      <div class="stat-card" @click="navigateTo('/contacts')">
        <div class="stat-icon icon-green">👥</div>
        <div class="stat-info">
          <h4>Danh bạ nội bộ</h4>
          <p class="stat-number">{{ totalContactsCount }} <span class="unit">nhân viên</span></p>
          <span class="stat-badge badge-green">● {{ onlineContactsCount }} trực tuyến</span>
        </div>
      </div>

      <!-- Thẻ 3: Tin nhắn chưa đọc -->
      <div class="stat-card" @click="navigateTo('/messages')">
        <div class="stat-icon icon-purple">💬</div>
        <div class="stat-info">
          <h4>Tin nhắn phòng chat</h4>
          <p class="stat-number">{{ totalUnreadMessages }} <span class="unit">tin mới</span></p>
          <span class="stat-badge badge-purple">{{ activeRoomsCount }} phòng hoạt động</span>
        </div>
      </div>

      <!-- Thẻ 4: Lịch sử cuộc gọi -->
      <div class="stat-card" @click="navigateTo('/history')">
        <div class="stat-icon icon-amber">🕒</div>
        <div class="stat-info">
          <h4>Cuộc gọi hôm nay</h4>
          <p class="stat-number">{{ totalCallsCount }} <span class="unit">cuộc</span></p>
          <span class="stat-badge badge-amber">{{ inboundCallsCount }} đến • {{ outboundCallsCount }} đi • {{ missedCallsCount }} nhỡ</span>
        </div>
      </div>
    </div>

    <!-- 3. Khu vực chính 2 cột: Thao tác nhanh & Giám sát hệ thống -->
    <div class="dashboard-main-grid">
      <!-- Cột Trái: Bàn phím quay số nhanh & Phím tắt liên hệ thường gọi -->
      <div class="grid-col left-col">
        <!-- Widget Quay số nhanh -->
        <div class="dash-card">
          <div class="card-header">
            <h3>⚡ Quay số nhanh (Speed Dial)</h3>
            <span class="header-hint">Nhập số máy lẻ nội bộ 4 số</span>
          </div>

          <div class="quick-dial-box">
            <input
              v-model="quickDialNumber"
              type="tel"
              placeholder="Nhập số máy lẻ (VD: 1002)..."
              class="quick-dial-input"
              maxlength="6"
              @keyup.enter="handleQuickDial"
            />
            <button class="btn-quick-call" @click="handleQuickDial">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z" />
              </svg>
              <span>Gọi ngay</span>
            </button>
          </div>

          <!-- Danh sách phím tắt liên hệ thường gọi -->
          <div class="speed-dial-chips">
            <span class="chips-label">Liên hệ nhanh:</span>
            <div class="chips-list">
              <button
                v-for="c in quickContacts"
                :key="c.ext"
                class="contact-chip"
                @click="callQuickContact(c.ext)"
              >
                <span class="chip-name">{{ c.name }}</span>
                <span class="chip-ext">{{ c.ext }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 4 Phím tắt điều hướng nhanh -->
        <div class="dash-card">
          <div class="card-header">
            <h3>🚀 Phím tắt phân hệ chính</h3>
          </div>

          <div class="nav-tiles">
            <div class="nav-tile" @click="navigateTo('/calls')">
              <span class="tile-icon">📞</span>
              <div class="tile-meta">
                <strong>Bàn phím quay số</strong>
                <span>Quay số máy lẻ & Đàm thoại</span>
              </div>
            </div>

            <div class="nav-tile" @click="navigateTo('/contacts')">
              <span class="tile-icon">📇</span>
              <div class="tile-meta">
                <strong>Danh bạ nhân viên</strong>
                <span>4 nút hành động chuẩn SDV</span>
              </div>
            </div>

            <div class="nav-tile" @click="navigateTo('/messages')">
              <span class="tile-icon">💬</span>
              <div class="tile-meta">
                <strong>Phòng chat nội bộ</strong>
                <span>Ghim thông báo & Read ID</span>
              </div>
            </div>

            <div class="nav-tile" @click="navigateTo('/history')">
              <span class="tile-icon">🕒</span>
              <div class="tile-meta">
                <strong>Lịch sử cuộc gọi</strong>
                <span>4 tab lọc & nút Gọi lại</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Cột Phải: Cuộc gọi gần đây & Liên hệ thường dùng -->
      <div class="grid-col right-col">
        <!-- Nhật ký cuộc gọi gần đây -->
        <div class="dash-card">
          <div class="card-header">
            <h3>🕒 Cuộc gọi gần đây</h3>
            <button class="btn-link" @click="navigateTo('/history')">Xem tất cả →</button>
          </div>

          <div class="recent-calls-list">
            <div v-for="call in recentCalls" :key="call.id" class="recent-call-item">
              <div :class="['call-direction-badge', call.direction]">
                {{ call.direction === 'inbound' ? '↙' : '↗' }}
              </div>
              <div class="call-info">
                <strong>{{ call.name }}</strong>
                <span>Máy lẻ {{ call.ext }} • {{ call.time }}</span>
              </div>
              <div class="call-duration">{{ call.duration }}</div>
              <button
                class="btn-call-back"
                title="Gọi lại ngay"
                @click="callQuickContact(call.ext)"
              >
                <svg class="phone-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Danh bạ liên hệ nhanh -->
        <div class="dash-card">
          <div class="card-header">
            <h3>⭐ Liên hệ thường dùng</h3>
            <button class="btn-link" @click="navigateTo('/contacts')">Xem danh bạ →</button>
          </div>

          <div class="frequent-contacts-list">
            <div v-for="c in quickContacts.slice(0, 4)" :key="c.ext" class="frequent-contact-item">
              <div class="contact-avatar-circle">
                {{ c.name.split(' ').slice(-1)[0][0] }}
              </div>
              <div class="contact-meta">
                <span class="contact-name">{{ c.name }}</span>
                <span class="contact-ext">Máy lẻ: {{ c.ext }}</span>
              </div>
              <button
                class="btn-quick-dial-action"
                title="Gọi trực tiếp"
                @click="callQuickContact(c.ext)"
              >
                <svg class="phone-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z" />
                </svg>
                <span>Gọi</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { contactService } from '@/services/contactService'
import { chatService } from '@/services/chatService'
import { historyService } from '@/services/historyService'
import { isFeatureEnabled } from '@/config/features'

const router = useRouter()

const userName = ref(localStorage.getItem('smartcall_username') || 'Quản trị viên')
const userExtension = ref(localStorage.getItem('smartcall_extension') || '1001')
const quickDialNumber = ref('')
const isPhoneConnected = ref(true)

// Các số liệu thống kê động cho 4 thẻ KPI
const totalContactsCount = ref(0)
const onlineContactsCount = ref(0)
const totalUnreadMessages = ref(0)
const activeRoomsCount = ref(0)
const totalCallsCount = ref(0)
const inboundCallsCount = ref(0)
const outboundCallsCount = ref(0)
const missedCallsCount = ref(0)

const userInitials = computed(() => {
  return userName.value
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(-2)
    .toUpperCase()
})

// Danh bạ gọi nhanh
const quickContacts = ref([])

// Cuộc gọi gần đây (động theo lịch sử CDR)
const recentCalls = ref([])

// Tải toàn bộ dữ liệu thống kê động từ các service
const loadDashboardData = async () => {
  // 1. Cập nhật thông tin User hiện tại
  userName.value = localStorage.getItem('smartcall_username') || 'Quản trị viên'
  userExtension.value = localStorage.getItem('smartcall_extension') || '1001'

  // 2. Tải thống kê Danh bạ nội bộ
  try {
    const contacts = await contactService.getContacts()
    if (Array.isArray(contacts)) {
      totalContactsCount.value = contacts.length
      onlineContactsCount.value =
        contacts.filter((c) => c.status === 'online' || c.status === 'available').length ||
        contacts.length

      // Cập nhật phím tắt danh bạ thường gọi
      const mappedQuick = contacts.slice(0, 5).map((c) => ({
        name: c.name,
        ext: String(c.number || c.extension || '1000'),
      }))
      quickContacts.value = mappedQuick
    }
  } catch (e) {
    console.warn('Lỗi tải danh bạ cho Dashboard:', e)
  }

  // 3. Tải thống kê Tin nhắn & Phòng chat
  try {
    const rooms = await chatService.getRooms()
    if (Array.isArray(rooms)) {
      activeRoomsCount.value = rooms.length
      totalUnreadMessages.value = rooms.reduce((acc, r) => acc + (r.unread || 0), 0)
    }
  } catch (e) {
    console.warn('Lỗi tải phòng chat cho Dashboard:', e)
  }

  // 4. Tải thống kê Lịch sử cuộc gọi (CDR)
  try {
    const history = await historyService.getHistory()
    if (Array.isArray(history)) {
      totalCallsCount.value = history.length
      inboundCallsCount.value = history.filter(
        (h) => h.direction === 'inbound' || h.direction === 'incoming',
      ).length
      outboundCallsCount.value = history.filter(
        (h) => h.direction === 'outbound' || h.direction === 'outgoing',
      ).length
      missedCallsCount.value = history.filter(
        (h) => h.status === 'missed' || h.status === 'declined' || !h.answered,
      ).length

      // Cập nhật danh sách 3 cuộc gọi gần nhất
      recentCalls.value = history.slice(0, 3).map((item, idx) => {
        const timePart = item.date ? item.date.split(' ')[1]?.slice(0, 5) : 'Vừa xong'
        const s = parseInt(item.duration, 10) || 0
        const m = Math.floor(s / 60)
        const rem = s % 60
        const durStr = `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`

        return {
          id: item.id || idx,
          name: item.name || `Máy lẻ ${item.extension}`,
          ext: item.extension || '1000',
          direction:
            item.direction === 'inbound' || item.direction === 'incoming' ? 'inbound' : 'outbound',
          time: timePart || '12:00',
          duration: durStr,
        }
      })
    }
  } catch (e) {
    console.warn('Lỗi tải lịch sử CDR cho Dashboard:', e)
  }
}

const navigateTo = (path) => {
  router.push(path)
}

const handleQuickDial = () => {
  const num = quickDialNumber.value.trim()
  if (!num) return
  callQuickContact(num)
}

const callQuickContact = (ext) => {
  const target = contactService.findContactByExtension(ext)
  if (target && (target.status === 'offline' || target.status === 'unavailable')) {
    const confirmMessage = confirm(
      `Máy lẻ [${target.name || ext}] hiện đang ngoại tuyến.\nBạn có muốn chuyển sang gửi tin nhắn không?`,
    )
    if (confirmMessage) {
      router.push({ path: '/messages', query: { ext, name: target.name } })
    }
    return
  }

  router.push({
    path: '/calls',
    query: {
      number: ext,
      autocall: 'true',
    },
  })
}

// Bấm thử giả lập cuộc gọi đến
const simulateCall = () => {
  window.dispatchEvent(
    new CustomEvent('wazo-incoming', {
      detail: {
        id: `call-${Date.now()}`,
        name: 'Nguyễn Hữu Hiếu',
        extension: '1007',
        sipUri: 'sip:1007@smartcall.internal',
        dept: 'Trưởng nhóm Phát triển Hệ thống',
      },
    }),
  )
}

const onPhoneRegistered = () => {
  isPhoneConnected.value = true
}

onMounted(() => {
  loadDashboardData()
  window.addEventListener('smartcall-cdr-updated', loadDashboardData)
  window.addEventListener('smartcall-rooms-updated', loadDashboardData)
  window.addEventListener('smartcall-contacts-updated', loadDashboardData)
  window.addEventListener('wazo-registered', onPhoneRegistered)
})

onUnmounted(() => {
  window.removeEventListener('smartcall-cdr-updated', loadDashboardData)
  window.removeEventListener('smartcall-rooms-updated', loadDashboardData)
  window.removeEventListener('smartcall-contacts-updated', loadDashboardData)
  window.removeEventListener('wazo-registered', onPhoneRegistered)
})
</script>

<style scoped>
.dashboard-view {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 1. Welcome Banner */
.welcome-banner {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: #ffffff;
  border-radius: 14px;
  padding: 24px 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 18px;
}

.banner-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0284c7, #0ea5e9);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
  font-weight: 800;
  border: 3px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.banner-text h1 {
  font-size: 1.45rem;
  font-weight: 800;
  margin: 0 0 6px 0;
  color: #ffffff;
}

.sub-text {
  font-size: 0.88rem;
  color: #94a3b8;
  margin: 0;
}

.sub-text strong {
  color: #38bdf8;
}

.btn-test-call-banner {
  background: #0284c7;
  color: #ffffff;
  border: 1px solid #38bdf8;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  box-shadow: 0 2px 10px rgba(2, 132, 199, 0.35);
}

.btn-test-call-banner:hover {
  background: #0369a1;
  transform: translateY(-1px);
}

/* 2. Top KPI Cards Grid */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: #cbd5e1;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
}

.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  flex-shrink: 0;
}

.icon-blue {
  background-color: #e0f2fe;
  color: #0284c7;
}

.icon-green {
  background-color: #dcfce7;
  color: #16a34a;
}

.icon-purple {
  background-color: #f3e8ff;
  color: #7e22ce;
}

.icon-amber {
  background-color: #fef3c7;
  color: #d97706;
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-info h4 {
  font-size: 0.8rem;
  text-transform: uppercase;
  color: #64748b;
  margin: 0 0 4px 0;
  letter-spacing: 0.5px;
}

.stat-number {
  font-size: 1.35rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 4px 0;
}

.stat-number .unit {
  font-size: 0.8rem;
  font-weight: normal;
  color: #64748b;
}

.stat-badge {
  font-size: 0.72rem;
  font-weight: 700;
  width: fit-content;
  padding: 2px 8px;
  border-radius: 10px;
}

.badge-green {
  background-color: #dcfce7;
  color: #15803d;
}

.badge-purple {
  background-color: #f3e8ff;
  color: #6b21a8;
}

.badge-amber {
  background-color: #fef3c7;
  color: #b45309;
}

/* 3. Main Two-Column Layout */
.dashboard-main-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

@media (max-width: 900px) {
  .dashboard-main-grid {
    grid-template-columns: 1fr;
  }
}

.dash-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  margin-bottom: 20px;
}

.dash-card:last-child {
  margin-bottom: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 10px;
}

.card-header h3 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0;
}

.header-hint {
  font-size: 0.8rem;
  color: #94a3b8;
}

.btn-link {
  background: none;
  border: none;
  color: #0284c7;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.btn-link:hover {
  text-decoration: underline;
}

/* Quick Dial Box */
.quick-dial-box {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.quick-dial-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.95rem;
  outline: none;
  transition: all 0.2s;
}

.quick-dial-input:focus {
  border-color: #0284c7;
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
}

.btn-quick-call {
  background-color: #0284c7;
  color: #ffffff;
  border: none;
  padding: 10px 18px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-quick-call:hover {
  background-color: #0369a1;
}

/* Speed Dial Chips */
.speed-dial-chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chips-label {
  font-size: 0.8rem;
  color: #64748b;
  font-weight: 600;
}

.chips-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.contact-chip {
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.contact-chip:hover {
  background-color: #e0f2fe;
  border-color: #bae6fd;
}

.chip-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1e293b;
}

.chip-ext {
  font-size: 0.75rem;
  font-family: monospace;
  background-color: rgba(0, 0, 0, 0.08);
  padding: 1px 6px;
  border-radius: 10px;
  color: #0284c7;
  font-weight: 700;
}

/* Nav Tiles */
.nav-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.nav-tile {
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-tile:hover {
  background-color: #f0f9ff;
  border-color: #bae6fd;
  transform: translateY(-2px);
}

.tile-icon {
  font-size: 1.6rem;
}

.tile-meta {
  display: flex;
  flex-direction: column;
}

.tile-meta strong {
  font-size: 0.88rem;
  color: #1e293b;
}

.tile-meta span {
  font-size: 0.75rem;
  color: #64748b;
}

/* Recent Calls List */
.recent-calls-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.recent-call-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background-color: #f8fafc;
  border-radius: 8px;
  border: 1px solid #f1f5f9;
}

.call-direction-badge {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.call-direction-badge.inbound {
  background-color: #dcfce7;
  color: #16a34a;
}

.call-direction-badge.outbound {
  background-color: #e0f2fe;
  color: #0284c7;
}

.call-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.call-info strong {
  font-size: 0.85rem;
  color: #1e293b;
}

.call-info span {
  font-size: 0.75rem;
  color: #64748b;
}

.call-duration {
  font-size: 0.8rem;
  font-weight: 600;
  color: #0284c7;
  font-family: monospace;
}

.btn-call-back {
  background-color: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-call-back:hover {
  background-color: #ecfdf5;
  border-color: #10b981;
}

.phone-action-icon {
  width: 15px;
  height: 15px;
  color: #10b981;
}

.btn-call-back:hover .phone-action-icon {
  color: #059669;
}

/* Frequent Contacts List */
.frequent-contacts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.frequent-contact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background-color: #f8fafc;
  border-radius: 8px;
  border: 1px solid #f1f5f9;
  transition: all 0.15s ease;
}

.frequent-contact-item:hover {
  background-color: #ffffff;
  border-color: #e2e8f0;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.03);
}

.contact-avatar-circle {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  font-weight: 700;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.contact-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.contact-name {
  font-size: 0.86rem;
  font-weight: 600;
  color: #1e293b;
}

.contact-ext {
  font-size: 0.75rem;
  color: #64748b;
}

.btn-quick-dial-action {
  background-color: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 0.78rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-quick-dial-action:hover {
  background-color: #10b981;
  color: white;
  border-color: #10b981;
}

.btn-quick-dial-action:hover .phone-action-icon {
  color: white;
}
</style>
