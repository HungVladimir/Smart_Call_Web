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
        :title="isSipOnline ? `Tổng đài: Trực tuyến (${userExtension})` : 'Chế độ ngoại tuyến (Nhấp để xem thông tin)'"
      >
        <span class="sip-dot"></span>
        <span class="sip-status-text">{{ isSipOnline ? `Trực tuyến (${userExtension})` : 'Ngoại tuyến' }}</span>
      </div>
    </div>

    <!-- Center Search Bar với Menu Gợi Ý Tự Động (Autocomplete) -->
    <div class="header-center" ref="searchContainerRef">
      <div class="search-bar">
        <svg class="search-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Tìm nhanh nhân viên, số máy lẻ (VD: 1002)..."
          @focus="showDropdown = true"
          @keyup.enter="handleSearch"
          @keyup.esc="showDropdown = false"
        />
        <button
          v-if="searchQuery"
          class="btn-clear-search"
          title="Xóa tìm kiếm"
          @click="clearSearch"
        >
          ✖
        </button>
      </div>

      <!-- Dropdown Gợi Ý Kết Quả Tìm Kiếm Nhanh -->
      <div
        v-if="showDropdown && searchQuery.trim() && matchingContacts.length > 0"
        class="search-dropdown"
      >
        <div class="dropdown-header">
          <span>GỢI Ý TÌM KIẾM NHANH ({{ matchingContacts.length }} KẾT QUẢ)</span>
        </div>

        <div class="dropdown-list">
          <div
            v-for="item in matchingContacts"
            :key="item.id"
            class="dropdown-item"
          >
            <div class="item-avatar" :class="{ offline: item.status === 'offline' }">
              {{ item.name.slice(0, 1) }}
            </div>

            <div class="item-info">
              <div class="item-name-row">
                <strong>{{ item.name }}</strong>
                <span class="status-dot" :class="item.status === 'online' ? 'online' : 'offline'"></span>
              </div>
              <small class="item-sub">
                Máy lẻ: <span class="ext-tag">{{ item.number }}</span> • {{ item.dept }}
              </small>
            </div>

            <div class="item-actions">
              <button
                class="btn-action-icon call"
                title="Gọi thoại ngay"
                @click.stop="quickCall(item)"
              >
                📞
              </button>
              <button
                class="btn-action-icon chat"
                title="Nhắn tin ngay"
                @click.stop="quickChat(item)"
              >
                💬
              </button>
            </div>
          </div>
        </div>

        <div class="dropdown-footer" @click="handleSearch">
          <span>Xem tất cả kết quả trong Danh bạ ➔</span>
        </div>
      </div>
    </div>

    <!-- User Profile & Status Dropdown -->
    <div class="header-right">
      <select v-model="presenceState" class="status-select" @change="updatePresence">
        <option value="available">🟢 Online (Sẵn sàng)</option>
        <option value="away">🟡 Vắng mặt (Away)</option>
        <option value="dnd">🔴 Đang bận (DND)</option>
      </select>

      <div class="user-profile">
        <div class="avatar-sm">{{ userInitials }}</div>
        <div class="user-info">
          <span class="user-name">{{ userName }}</span>
          <span class="user-ext">Máy lẻ: {{ userExtension }}</span>
        </div>
      </div>

      <!-- Nút Cài đặt hệ thống -->
      <button class="btn-settings-header" title="Cài đặt hệ thống" @click="$emit('open-settings')">
        ⚙️ SETTINGS
      </button>

      <button class="btn-logout-header" title="Đăng xuất khỏi hệ thống" @click="$emit('logout')">
        🚪 Thoát
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
                {{ isSipOnline ? `Trực tuyến — Máy lẻ ${userExtension}` : 'Chế độ ngoại tuyến (Offline / Thử nghiệm)' }}
              </div>
              <div class="summary-desc">
                {{ isSipOnline ? 'Đã kết nối an toàn với máy chủ Wazo Platform qua cổng bảo mật WSS.' : 'Các tính năng danh bạ, tin nhắn nội bộ và mô phỏng đàm thoại vẫn hoạt động trơn tru.' }}
              </div>
            </div>
          </div>

          <div class="sip-guide-section">
            <div class="guide-title">💡 Kích hoạt luồng gọi thoại WebRTC thật qua máy chủ:</div>
            <ol class="guide-steps">
              <li>Mở tab mới trên trình duyệt và truy cập: <a href="https://107.126.11.126:9443" target="_blank" class="sip-server-link">https://107.126.11.126:9443</a></li>
              <li>Chọn <strong>Nâng cao (Advanced)</strong> &rarr; Bấm <strong>Tiếp tục truy cập 107.126.11.126 (không an toàn)</strong> để xác nhận tin cậy cổng WSS.</li>
              <li>Quay lại màn hình SmartCall Web và tải lại trang (<strong>F5</strong>). Tổng đài sẽ tự động nhận diện máy lẻ.</li>
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
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { contactService } from '@/services/contactService'
import { wazoService, callStore } from '@/services/wazo'

const router = useRouter()
defineEmits(['logout', 'open-settings'])

const searchQuery = ref('')
const presenceState = ref('available')
const showDropdown = ref(false)
const searchContainerRef = ref(null)
const contactsList = ref([])

// Lấy thông tin tài khoản đang đăng nhập đồng bộ từ callStore (SSOT)
const userName = computed(() => callStore.myUserName || localStorage.getItem('smartcall_username') || 'Quản trị viên')
const userExtension = computed(() => callStore.myExtension || localStorage.getItem('smartcall_extension') || '1001')
const isSipOnline = computed(
  () =>
    callStore.isRegistered ||
    (Boolean(localStorage.getItem('smartcall_wazo_token')) && localStorage.getItem('smartcall_offline_mode') !== 'true'),
)
const showSipInfoModal = ref(false)

const showSipHelp = () => {
  showSipInfoModal.value = true
}

onMounted(async () => {
  try {
    contactsList.value = await contactService.getContacts()
  } catch (e) {
    /* ignore */
  }
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const handleClickOutside = (e) => {
  if (searchContainerRef.value && !searchContainerRef.value.contains(e.target)) {
    showDropdown.value = false
  }
}

// Lọc tối đa 5 kết quả trùng khớp cho thanh Autocomplete
const matchingContacts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return contactsList.value
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.number && c.number.includes(q)) ||
        (c.dept && c.dept.toLowerCase().includes(q)),
    )
    .slice(0, 5)
})

const userInitials = computed(() => {
  if (!userName.value) return 'U'
  return userName.value
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(-2)
    .toUpperCase()
})

const goHome = () => {
  router.push('/dashboard')
}

const clearSearch = () => {
  searchQuery.value = ''
  showDropdown.value = false
}

const handleSearch = () => {
  showDropdown.value = false
  if (searchQuery.value.trim()) {
    router.push({ path: '/contacts', query: { q: searchQuery.value.trim() } })
  }
}

// Gọi nhanh từ dropdown
const quickCall = (contact) => {
  showDropdown.value = false
  if (contact.status === 'offline' || contact.status === 'unavailable') {
    const confirmMessage = confirm(
      `Máy lẻ [${contact.name} - ${contact.number}] hiện đang ngoại tuyến.\nBạn có muốn chuyển sang gửi tin nhắn không?`,
    )
    if (confirmMessage) {
      quickChat(contact)
    }
    return
  }

  router.push({
    path: '/calls',
    query: { number: contact.number, autocall: 'true' },
  })
}

// Nhắn tin nhanh từ dropdown
const quickChat = (contact) => {
  showDropdown.value = false
  router.push({
    path: '/messages',
    query: { ext: contact.number, name: contact.name },
  })
}

const updatePresence = async () => {
  await wazoService.setPresence(presenceState.value)
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

.search-icon-svg {
  width: 16px;
  height: 16px;
  color: #768390;
  flex-shrink: 0;
}

.search-bar:focus-within .search-icon-svg {
  color: #64b5f6;
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

/* Center Search Container with Dropdown */
.header-center {
  flex: 1;
  max-width: 480px;
  margin: 0 30px;
  position: relative;
}

.search-bar {
  width: 100%;
  display: flex;
  align-items: center;
  background: #2d333b;
  border-radius: 20px;
  padding: 6px 14px;
  border: 1px solid #444c56;
  transition: border-color 0.2s;
}

.search-bar:focus-within {
  border-color: #64b5f6;
  box-shadow: 0 0 0 2px rgba(100, 181, 246, 0.2);
}

.search-bar input {
  background: transparent;
  border: none;
  outline: none;
  color: white;
  width: 100%;
  font-size: 0.88rem;
  margin-left: 8px;
}

.search-bar input::placeholder {
  color: #768390;
}

.btn-clear-search {
  background: none;
  border: none;
  color: #8b949e;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0 4px;
}

.btn-clear-search:hover {
  color: white;
}

/* Floating Autocomplete Dropdown */
.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 8px;
  background: #22272e;
  border: 1px solid #444c56;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-header {
  padding: 8px 12px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #768390;
  border-bottom: 1px solid #343a40;
  background: #1c2128;
}

.dropdown-list {
  max-height: 280px;
  overflow-y: auto;
}

.dropdown-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #2d333b;
  gap: 10px;
  transition: background 0.15s;
}

.dropdown-item:hover {
  background: #2d333b;
}

.item-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.item-avatar.offline {
  background: #64748b;
}

.item-info {
  flex: 1;
  min-width: 0;
}

.item-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.item-name-row strong {
  font-size: 0.85rem;
  color: #e6edf3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.online {
  background: #10b981;
}

.status-dot.offline {
  background: #94a3b8;
}

.item-sub {
  color: #8b949e;
  font-size: 0.75rem;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-tag {
  color: #64b5f6;
  font-weight: 600;
}

.item-actions {
  display: flex;
  gap: 6px;
}

.btn-action-icon {
  background: #343a40;
  border: 1px solid #444c56;
  border-radius: 4px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.82rem;
  transition: all 0.15s;
}

.btn-action-icon.call:hover {
  background: #10b981;
  border-color: #10b981;
}

.btn-action-icon.chat:hover {
  background: #3b82f6;
  border-color: #3b82f6;
}

.dropdown-footer {
  padding: 8px 12px;
  background: #1c2128;
  color: #58a6ff;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  border-top: 1px solid #343a40;
  transition: background 0.15s;
}

.dropdown-footer:hover {
  background: #2d333b;
  text-decoration: underline;
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
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
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
</style>
