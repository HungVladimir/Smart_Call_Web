<template>
  <header class="app-header">
    <div class="header-left">
      <div class="brand-logo" @click="goHome">
        <img src="/app-icon.webp" alt="SmartCall" class="brand-icon-img" />
        <span>SmartCall</span>
      </div>
      <div
        class="sip-status-badge"
        :class="{ online: isSipOnline, offline: !isSipOnline }"
        @click="showSipHelp"
        :title="
          isSipOnline
            ? `Tổng đài: Trực tuyến (máy lẻ: ${userExtension})`
            : 'Chế độ ngoại tuyến (Nhấp để xem thông tin)'
        "
      >
        <span class="sip-dot"></span>
        <span class="sip-status-text">{{
          isSipOnline ? `Trực tuyến (máy lẻ: ${userExtension})` : 'Ngoại tuyến'
        }}</span>
      </div>
    </div>

    <!-- User Profile & Status Dropdown -->
    <div class="header-right">
      <select
        v-model="presenceState"
        class="status-select"
        aria-label="Trạng thái hiện diện trực tuyến"
        @change="updatePresence"
      >
        <option value="available">🟢 Online (Sẵn sàng)</option>
        <option value="away">🟡 Vắng mặt (Away)</option>
        <option value="dnd">🔴 Đang bận (DND)</option>
      </select>

      <div class="user-profile">
        <div class="avatar-sm">{{ userInitials }}</div>
        <div class="user-info">
          <span class="user-name">{{ userDisplayName }}</span>
        </div>
      </div>

      <!-- Nút Cài đặt hệ thống -->
      <button class="btn-settings-header" title="Cài đặt hệ thống" @click="$emit('open-settings')">
        ⚙️ <span class="header-btn-text">SETTINGS</span>
      </button>

      <button class="btn-logout-header" title="Đăng xuất khỏi hệ thống" @click="$emit('logout')">
        🚪 <span class="header-btn-text">Thoát</span>
      </button>
    </div>

    <!-- Modal Thông tin Trạng thái Kết nối Tổng đài SIP / WebRTC -->
    <div v-if="showSipInfoModal" class="sip-modal-backdrop" @click.self="showSipInfoModal = false">
      <div class="sip-modal-card">
        <div class="sip-modal-header">
          <div class="sip-modal-title">
            <span class="sip-modal-dot" :class="{ online: isSipOnline }"></span>
            <h3>Thông Tin Kết Nối Tổng Đài</h3>
          </div>
          <button class="btn-close-modal" @click="showSipInfoModal = false">✕</button>
        </div>

        <div class="sip-modal-body">
          <div class="status-summary-box" :class="{ online: isSipOnline }">
            <div class="summary-icon">{{ isSipOnline ? '🟢' : '⚪' }}</div>
            <div class="summary-text">
              <div class="summary-title">
                {{
                  isSipOnline
                    ? `Trực tuyến — Máy lẻ ${userExtension}`
                    : 'Chưa đăng ký kết nối thoại'
                }}
              </div>
              <div class="summary-desc">
                {{
                  isSipOnline
                    ? 'Đã kết nối an toàn với máy chủ tổng đài qua cổng bảo mật WSS.'
                    : 'Kết nối thoại chưa sẵn sàng. Vui lòng kiểm tra mạng và trạng thái đăng ký tổng đài.'
                }}
              </div>
            </div>
          </div>

          <div class="sip-guide-section">
            <div class="guide-title">💡 Kích hoạt luồng gọi thoại WebRTC thật qua máy chủ:</div>
            <ol class="guide-steps">
              <li>
                Mở tab mới trên trình duyệt và truy cập:
                <a :href="authService.getHostUrl()" target="_blank" class="sip-server-link">{{
                  authService.getHostUrl()
                }}</a>
              </li>
              <li>
                Chọn <strong>Nâng cao (Advanced)</strong> &rarr; Bấm
                <strong>Tiếp tục truy cập máy chủ tổng đài</strong> để xác nhận tin cậy cổng WSS.
              </li>
              <li>
                Quay lại màn hình SmartCall Web và tải lại trang (<strong>F5</strong>). Tổng đài sẽ
                tự động nhận diện máy lẻ.
              </li>
            </ol>
          </div>
        </div>

        <div class="sip-modal-footer">
          <button class="btn-sip-modal-close" @click="showSipInfoModal = false">Đã hiểu</button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { authService } from '@/services/index.js'
import { callState } from '@/state/callState.js'
import { userSessionState } from '@/state/sessionState.js'

const router = useRouter()
defineEmits(['logout', 'open-settings'])

const presenceState = ref('available')

// Lấy thông tin tài khoản đang đăng nhập đồng bộ từ callState (SSOT)
const userName = computed(
  () =>
    userSessionState.displayName || localStorage.getItem('smartcall_username') || 'Quản trị viên',
)
/** Đọc máy lẻ người đang đăng nhập để hiển thị trên Header. */
const userExtension = computed(
  () => userSessionState.extension || localStorage.getItem('smartcall_extension') || '',
)
/** Đọc phòng ban hiện tại để bổ sung thông tin người dùng trên Header. */
const userDepartment = computed(
  () =>
    userSessionState.department ||
    localStorage.getItem('smartcall_department') ||
    localStorage.getItem('smartcall_user_department') ||
    '',
)
/** Ghép thông tin tên/phòng ban thành nhãn người dùng trong Header. */
const userDisplayName = computed(() => {
  if (userDepartment.value) {
    return `${userName.value} : ${userDepartment.value}`
  }
  return userName.value
})
/** Chỉ báo trực tuyến khi SDK đã đăng ký SIP, không suy trạng thái thoại từ việc có token. */
const isSipOnline = computed(() => callState.isRegistered)
const showSipInfoModal = ref(false)

/** Mở phần thông tin kết nối thoại để người dùng kiểm tra trạng thái SIP. */
const showSipHelp = () => {
  showSipInfoModal.value = true
}

/** Tính chữ viết tắt của tên người dùng cho avatar Header. */
const userInitials = computed(() => {
  if (!userName.value) return 'U'
  return userName.value
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(-2)
    .toUpperCase()
})

/** Điều hướng từ Header về màn hình chính đang được ứng dụng sử dụng. */
const goHome = () => {
  router.push('/calls')
}

/** Gửi lựa chọn trạng thái hiện diện qua AuthService và cập nhật trạng thái hiển thị liên quan. */
const updatePresence = async () => {
  await authService.updatePresence(presenceState.value)
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `Đã cập nhật trạng thái: ${presenceState.value.toUpperCase()}` },
    }),
  )
}
</script>

<style scoped>
.app-header {
  background-color: #1e2227;
  color: white;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid #343a40;
  flex-shrink: 0;
  z-index: 100;
  position: relative;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 1.25rem;
  color: #64b5f6;
  cursor: pointer;
}

.brand-icon-img {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: contain;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.brand-logo svg {
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.3));
}

.sip-status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  user-select: none;
}

.sip-status-badge.online {
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.sip-status-badge.offline {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.sip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.sip-status-badge.online .sip-dot {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}

.sip-status-badge.offline .sip-dot {
  background: #94a3b8;
}

/* Header Right */
.header-right {
  display: flex;
  align-items: center;
  gap: 18px;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-sm {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: white;
  font-size: 0.85rem;
}

.user-info {
  display: flex;
  flex-direction: column;
  text-align: right;
}

.user-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #e2e8f0;
}

.user-ext {
  font-size: 0.75rem;
  color: #94a3b8;
}

.status-select {
  background: #2d333b;
  color: #48bb78;
  border: 1px solid #444c56;
  border-radius: 14px;
  padding: 3px 8px;
  font-size: 0.75rem;
  font-weight: 600;
  outline: none;
  cursor: pointer;
}

.status-select option {
  background: #1e2227;
  color: white;
}

.btn-settings-header {
  background: #2d333b;
  border: 1px solid #444c56;
  color: #cbd5e1;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.btn-settings-header:hover {
  background: #384252;
  color: white;
  border-color: #64b5f6;
}

.btn-logout-header {
  background: transparent;
  border: 1px solid #e74c3c;
  color: #e74c3c;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

.btn-logout-header:hover {
  background: #e74c3c;
  color: white;
}

/* Modal Thông tin Kết nối SIP / WebRTC */
.sip-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeInModal 0.2s ease-out;
}

@keyframes fadeInModal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.sip-modal-card {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 14px;
  width: 90%;
  max-width: 520px;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.5),
    0 8px 10px -6px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.sip-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #334155;
  background: #0f172a;
}

.sip-modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sip-modal-title h3 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: #f8fafc;
}

.sip-modal-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #94a3b8;
}

.sip-modal-dot.online {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.8);
}

.btn-close-modal {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s;
}

.btn-close-modal:hover {
  background: #334155;
  color: #f8fafc;
}

.sip-modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: #cbd5e1;
  font-size: 0.9rem;
  line-height: 1.5;
}

.status-summary-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #0f172a;
  border: 1px solid #334155;
}

.status-summary-box.online {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.08);
}

.summary-icon {
  font-size: 1.4rem;
  line-height: 1;
}

.summary-title {
  font-weight: 700;
  font-size: 0.95rem;
  color: #f8fafc;
  margin-bottom: 4px;
}

.status-summary-box.online .summary-title {
  color: #4ade80;
}

.summary-desc {
  font-size: 0.85rem;
  color: #94a3b8;
}

.sip-guide-section {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 14px 16px;
}

.guide-title {
  font-weight: 700;
  color: #38bdf8;
  margin-bottom: 8px;
  font-size: 0.88rem;
}

.guide-steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.85rem;
}

.guide-steps li {
  color: #cbd5e1;
}

.sip-server-link {
  color: #38bdf8;
  text-decoration: underline;
  word-break: break-all;
}

.sip-server-link:hover {
  color: #7dd3fc;
}

.sip-modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid #334155;
  background: #0f172a;
}

.btn-sip-modal-close {
  background: #0284c7;
  color: white;
  border: none;
  padding: 8px 20px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-sip-modal-close:hover {
  background: #0369a1;
}

@media (max-width: 768px) {
  .app-header {
    height: 50px;
    padding: 0 10px;
  }

  .header-left .sip-status-badge .sip-status-text {
    display: none;
  }

  .header-right {
    gap: 8px;
  }

  .user-info {
    display: none;
  }

  .status-select {
    font-size: 0.72rem;
    padding: 2px 4px;
    max-width: 90px;
  }

  .header-btn-text {
    display: none;
  }

  .btn-settings-header,
  .btn-logout-header {
    padding: 5px 8px;
    font-size: 0.9rem;
  }
}
</style>
