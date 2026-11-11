<template>
  <header class="app-header">
    <div class="header-left">
      <div class="brand-logo" @click="goHome">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="#2196f3">
          <path d="M20 15.5c-1.2 0-2.4-.2-3.6-.6-.3-.1-.7 0-1 .2l-2.2 2.2c-2.8-1.4-5.1-3.8-6.6-6.6l2.2-2.2c.3-.3.4-.7.2-1-.3-1.1-.5-2.3-.5-3.5 0-.6-.4-1-1-1H4c-.6 0-1 .4-1 1 0 9.4 7.6 17 17 17 .6 0 1-.4 1-1v-3.5c0-.6-.4-1-1-1z" />
        </svg>
        <span>SmartCall</span>
      </div>
      <span class="badge-lan">Wazo 26.10 LAN</span>
    </div>

    <!-- Center Search Bar -->
    <div class="header-center">
      <div class="search-bar">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Tìm nhanh nhân viên, số máy lẻ (VD: 1002)..."
          @keyup.enter="handleSearch"
        />
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

      <!-- Nút SETTINGS theo web1.webp -->
      <button class="btn-settings-header" title="Cài đặt hệ thống (Âm thanh, Chuyển tiếp, Mật khẩu)" @click="$emit('open-settings')">
        ⚙️ SETTINGS
      </button>

      <button class="btn-logout-header" title="Đăng xuất khỏi hệ thống" @click="$emit('logout')">
        🚪 Thoát
      </button>
    </div>
  </header>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
defineEmits(['logout'])

const searchQuery = ref('')
const presenceState = ref('available')

// Mock or passed user info
const userName = ref(localStorage.getItem('smartcall_username') || 'Lê Việt Dũng')
const userExtension = ref(localStorage.getItem('smartcall_extension') || '1001')

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

const handleSearch = () => {
  if (searchQuery.value.trim()) {
    // Navigate to contacts with query
    router.push({ path: '/contacts', query: { q: searchQuery.value.trim() } })
  }
}

const updatePresence = () => {
  // Có thể phát event hoặc gọi API wazo-chatd cập nhật presence
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `Đã chuyển trạng thái sang: ${presenceState.value.toUpperCase()}` },
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

.brand-logo svg {
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.3));
}

.badge-lan {
  background: #2c3e50;
  color: #a0aec0;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid #4a5568;
}

.header-center {
  flex: 1;
  max-width: 480px;
  margin: 0 30px;
}

.search-bar {
  width: 100%;
  display: flex;
  align-items: center;
  background: #2d333b;
  border-radius: 20px;
  padding: 6px 14px;
  border: 1px solid #444c56;
}

.search-bar input {
  background: transparent;
  border: none;
  outline: none;
  color: white;
  width: 100%;
  font-size: 0.9rem;
  margin-left: 8px;
}

.search-bar input::placeholder {
  color: #768390;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 18px;
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
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
</style>

