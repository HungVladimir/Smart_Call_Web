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
            Hệ thống liên lạc hợp nhất SmartCall UC • Mạng LAN nội bộ SDV • Máy lẻ SIP:
            <strong>{{ userExtension }}@192.168.1.50</strong>
          </p>
        </div>
      </div>

      <div class="banner-actions">
        <!-- Nút Test mô phỏng cuộc gọi đến -->
        <button class="btn-test-call-banner" @click="simulateCall">
          🔔 Thử cuộc gọi đến (app5.webp)
        </button>
      </div>
    </div>

    <!-- 2. Thẻ thống kê tổng quan (Top 4 KPI Cards) -->
    <div class="stat-grid">
      <!-- Thẻ 1: Máy lẻ WebRTC -->
      <div class="stat-card" @click="navigateTo('/calls')">
        <div class="stat-icon icon-blue">📞</div>
        <div class="stat-info">
          <h4>Máy lẻ WebRTC</h4>
          <p class="stat-number">{{ userExtension }}</p>
          <span class="stat-badge badge-green">● Registered Online</span>
        </div>
      </div>

      <!-- Thẻ 2: Tổng đài Wazo LAN -->
      <div class="stat-card" @click="openSettings">
        <div class="stat-icon icon-green">📶</div>
        <div class="stat-info">
          <h4>Máy chủ Wazo</h4>
          <p class="stat-number">192.168.1.50</p>
          <span class="stat-badge badge-green">Cổng 9443 SSL Ready</span>
        </div>
      </div>

      <!-- Thẻ 3: Tin nhắn chưa đọc -->
      <div class="stat-card" @click="navigateTo('/messages')">
        <div class="stat-icon icon-purple">💬</div>
        <div class="stat-info">
          <h4>Tin nhắn phòng chat</h4>
          <p class="stat-number">5 <span class="unit">tin mới</span></p>
          <span class="stat-badge badge-purple">3 phòng hoạt động</span>
        </div>
      </div>

      <!-- Thẻ 4: Lịch sử cuộc gọi -->
      <div class="stat-card" @click="navigateTo('/history')">
        <div class="stat-icon icon-amber">🕒</div>
        <div class="stat-info">
          <h4>Cuộc gọi hôm nay</h4>
          <p class="stat-number">7 <span class="unit">cuộc</span></p>
          <span class="stat-badge badge-amber">4 đến • 3 đi • 1 nhỡ</span>
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
              📞 Gọi ngay
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

      <!-- Cột Phải: Cuộc gọi gần đây & Trạng thái dịch vụ Wazo -->
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
                📞
              </button>
            </div>
          </div>
        </div>

        <!-- Bảng trạng thái Microservices Wazo Platform 26.10 -->
        <div class="dash-card">
          <div class="card-header">
            <h3>⚙️ Trạng thái dịch vụ Wazo (LAN 192.168.1.50)</h3>
            <span class="status-indicator-live">● Đang hoạt động</span>
          </div>

          <div class="services-status-table">
            <div class="service-row">
              <span class="service-name">wazo-auth (Xác thực & Token)</span>
              <span class="service-status ready">🟢 Hoạt động</span>
            </div>
            <div class="service-row">
              <span class="service-name">wazo-calld (Thoại WebRTC SIP)</span>
              <span class="service-status ready">🟢 Sẵn sàng</span>
            </div>
            <div class="service-row">
              <span class="service-name">wazo-chatd (Tin nhắn & Presence)</span>
              <span class="service-status ready">🟢 Sẵn sàng</span>
            </div>
            <div class="service-row">
              <span class="service-name">wazo-call-logd (Nhật ký CDR)</span>
              <span class="service-status ready">🟢 Sẵn sàng</span>
            </div>
            <div class="service-row">
              <span class="service-name">wazo-websocketd (Realtime v2)</span>
              <span class="service-status ready">🟢 Kết nối</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const userName = ref(localStorage.getItem('smartcall_username') || 'Lê Việt Dũng')
const userExtension = ref(localStorage.getItem('smartcall_extension') || '1001')
const quickDialNumber = ref('')

const userInitials = computed(() => {
  return userName.value
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(-2)
    .toUpperCase()
})

// Danh bạ gọi nhanh
const quickContacts = [
  { name: 'Alice Nguyễn', ext: '1002' },
  { name: 'Bob Trần', ext: '1003' },
  { name: 'Storm', ext: '1005' },
  { name: 'Đức Anh', ext: '1006' },
  { name: 'Kaito Hiếu', ext: '1007' },
]

// Cuộc gọi gần đây
const recentCalls = [
  { id: 1, name: '조창연 (이윤수)', ext: '1002', direction: 'inbound', time: '15:39', duration: '00:09' },
  { id: 2, name: 'Nguyễn Hữu Hiếu (Kaito)', ext: '1007', direction: 'inbound', time: '15:00', duration: '00:24' },
  { id: 3, name: 'Bob Trần', ext: '1003', direction: 'outbound', time: '13:28', duration: '03:02' },
]

const navigateTo = (path) => {
  router.push(path)
}

const openSettings = () => {
  window.dispatchEvent(new CustomEvent('open-app-settings'))
}

const handleQuickDial = () => {
  const num = quickDialNumber.value.trim()
  if (!num) return
  callQuickContact(num)
}

const callQuickContact = (ext) => {
  router.push({
    path: '/calls',
    query: {
      number: ext,
      autocall: 'true',
    },
  })
}

// Bấm thử giả lập cuộc gọi đến (app5.webp)
const simulateCall = () => {
  window.dispatchEvent(
    new CustomEvent('wazo-incoming', {
      detail: {
        id: `call-${Date.now()}`,
        name: 'Nguyễn Hữu Hiếu (Kaito)',
        extension: '1007',
        sipUri: 'sip:1007@192.168.1.50',
        dept: 'SDV MES Application Group Lead',
      },
    }),
  )
}
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

/* Services Status Table */
.services-status-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.service-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #f8fafc;
  border-radius: 6px;
  font-size: 0.85rem;
}

.service-name {
  color: #334155;
  font-family: monospace;
  font-size: 0.82rem;
}

.service-status.ready {
  color: #15803d;
  font-weight: 600;
  font-size: 0.8rem;
}

.status-indicator-live {
  font-size: 0.78rem;
  font-weight: 700;
  color: #16a34a;
}
</style>
