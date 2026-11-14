<template>
  <div class="contacts-container">
    <!-- Header Toolbar -->
    <div class="contacts-header">
      <div class="header-left">
        <h1>Danh bạ nhân viên</h1>
        <span class="sub-title">Danh sách máy lẻ nội bộ hệ thống tổng đài LAN</span>
      </div>

      <div class="header-actions">
        <!-- Search Input -->
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchTerm"
            placeholder="Tìm kiếm theo tên, phòng ban hoặc số máy..."
            class="search-input"
          />
          <button v-if="searchTerm" class="btn-clear-search" @click="searchTerm = ''">✖</button>
        </div>

        <!-- Nút Làm Mới Danh Bạ Chuẩn Theo Mã Tham Chiếu -->
        <button
          class="btn-refresh"
          :disabled="loading"
          title="Làm mới danh bạ từ máy chủ tổng đài"
          @click="refreshContacts"
        >
          <span :class="{ 'spin-icon': loading }">↻</span> Làm mới
        </button>
      </div>
    </div>

    <!-- Filter Tabs: Tất cả vs Yêu thích ⭐ -->
    <div class="filter-tabs-bar">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'all' }"
        @click="activeTab = 'all'"
      >
        👥 Tất cả nhân viên ({{ contacts.length }})
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'favorites' }"
        @click="activeTab = 'favorites'"
      >
        ⭐ Mục yêu thích ({{ favoriteCount }})
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading && contacts.length === 0" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải danh bạ nhân viên từ máy chủ Wazo...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredContacts.length === 0" class="state-message empty">
      <p v-if="activeTab === 'favorites'">
        Chưa có liên hệ nào trong mục Yêu thích. Hãy bấm vào biểu tượng ⭐ trên dòng nhân viên để ghim nhanh.
      </p>
      <p v-else-if="searchTerm">
        Không tìm thấy nhân viên nào phù hợp với từ khóa "{{ searchTerm }}".
      </p>
      <p v-else>
        Chưa có liên hệ nào trong danh bạ hệ thống tổng đài.
      </p>
    </div>

    <!-- Contact Table -->
    <div v-else class="table-card">
      <table class="contact-table">
        <thead>
          <tr>
            <th style="width: 44px; text-align: center;">⭐</th>
            <th>Nhân viên</th>
            <th>Bộ phận / Phòng ban</th>
            <th>Số máy lẻ</th>
            <th>Trạng thái</th>
            <th style="text-align: right; width: 140px;">Thao tác nhanh</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contact in filteredContacts" :key="contact.id">
            <!-- 0. Favorite Star Toggle -->
            <td style="text-align: center;">
              <button
                class="btn-star"
                :class="{ active: contact.isFavorite }"
                :title="contact.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
                @click="toggleFavorite(contact)"
              >
                {{ contact.isFavorite ? '⭐' : '☆' }}
              </button>
            </td>

            <!-- 1. Tên & Avatar -->
            <td>
              <div class="contact-user-cell">
                <div class="avatar-circle" :style="{ backgroundColor: getAvatarColor(contact.name) }">
                  {{ getInitials(contact.name) }}
                </div>
                <div class="user-meta">
                  <strong class="user-hname">{{ contact.name }}</strong>
                  <span class="user-email">{{ contact.email || 'Nội bộ công ty' }}</span>
                </div>
              </div>
            </td>

            <!-- 2. Phòng ban -->
            <td>
              <span class="dept-badge">{{ contact.dept || 'Khối Kỹ thuật' }}</span>
            </td>

            <!-- 3. Số máy lẻ -->
            <td>
              <span class="ext-tag">📞 {{ contact.number || 'Chưa gán máy lẻ' }}</span>
            </td>

            <!-- 4. Trạng thái Online/Offline/Busy từ Wazo Presence -->
            <td>
              <div class="status-cell">
                <span
                  class="status-dot"
                  :class="`status-${contact.status || 'offline'}`"
                ></span>
                <span class="status-label" :class="`label-${contact.status || 'offline'}`">
                  {{ contact.statusLabel || 'Ngoại tuyến' }}
                </span>
              </div>
            </td>

            <!-- 5. Các Nút Chức Năng Thao Tác -->
            <td style="text-align: right;">
              <div class="action-buttons-group">
                <!-- Nút 1: Gọi thoại qua WebRTC -->
                <button
                  class="btn-icon btn-call"
                  title="Gọi thoại qua WebRTC"
                  @click="handleCall(contact)"
                >
                  📞
                </button>

                <!-- Nút 2: Nhắn tin -->
                <button
                  class="btn-icon btn-msg"
                  title="Mở cuộc trò chuyện"
                  @click="handleMessage(contact)"
                >
                  💬
                  <span v-if="contact.unreadCount > 0" class="badge-unread">
                    {{ contact.unreadCount }}
                  </span>
                </button>

                <!-- Nút 3: Gọi Video (Thông báo tính năng) -->
                <button
                  class="btn-icon btn-video"
                  title="Gọi Video"
                  @click="handleVideoCall(contact)"
                >
                  🎥
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, onActivated } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { contactService } from '@/services/contactService'
import { wazoService } from '@/services/wazo'

const router = useRouter()
const route = useRoute()

const searchTerm = ref('')
const contacts = ref([])
const loading = ref(false)
const activeTab = ref('all') // 'all' | 'favorites'

const onContactsUpdated = () => {
  if (contactService.currentContacts) {
    contacts.value = [...contactService.currentContacts]
  }
}

onMounted(() => {
  if (route.query.q) {
    searchTerm.value = String(route.query.q)
  }
  loadContacts(false)
  window.addEventListener('smartcall-contacts-updated', onContactsUpdated)
})

// Tối ưu KeepAlive mượt mà: Nếu đã có dữ liệu, hiển thị ngay lập tức (0ms) và chỉ refresh ngầm
onActivated(() => {
  if (contactService.currentContacts && contactService.currentContacts.length > 0) {
    contacts.value = [...contactService.currentContacts]
    loadContacts(true)
  } else {
    loadContacts(false)
  }
})

onUnmounted(() => {
  window.removeEventListener('smartcall-contacts-updated', onContactsUpdated)
})

const loadContacts = async (silent = false) => {
  if (!silent && contacts.value.length === 0) {
    loading.value = true
  }
  try {
    const fresh = await contactService.getContacts()
    contacts.value = [...fresh]
  } catch (err) {
    console.warn('Lỗi nạp danh bạ Wazo:', err)
  } finally {
    loading.value = false
  }
}

// Làm mới danh bạ thủ công
const refreshContacts = async () => {
  loading.value = true
  try {
    const fresh = await contactService.getContacts()
    contacts.value = [...fresh]
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `✅ Đã làm mới danh bạ (${fresh.length} liên hệ)!`,
          type: 'success',
        },
      }),
    )
  } catch (err) {
    console.warn('Lỗi làm mới danh bạ:', err)
  } finally {
    loading.value = false
  }
}

const favoriteCount = computed(() => {
  return contacts.value.filter((c) => c.isFavorite).length
})

// Bật/tắt trạng thái Yêu thích
const toggleFavorite = (contact) => {
  contact.isFavorite = contactService.toggleFavorite(contact.id)
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: contact.isFavorite
          ? `Đã thêm [${contact.name}] vào mục Yêu thích ⭐`
          : `Đã bỏ [${contact.name}] khỏi mục Yêu thích`,
        type: 'info',
      },
    }),
  )
}

// Lọc danh bạ theo tab và từ khóa tìm kiếm (hỗ trợ tiếng Việt không dấu)
const filteredContacts = computed(() => {
  let list = contacts.value

  if (activeTab.value === 'favorites') {
    list = list.filter((c) => c.isFavorite)
  }

  if (!searchTerm.value.trim()) return list
  return list.filter((c) => contactService.matchesSearch(c, searchTerm.value))
})

// 1. Gọi thoại (Kiểm tra Máy bận / Offline, chuyển sang CallsView)
const handleCall = (contact) => {
  if (!contact || !contact.number) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Liên hệ [${contact?.name || 'này'}] chưa có số máy lẻ để thực hiện cuộc gọi thoại!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // Chặn nếu bản thân người dùng đang trong một cuộc gọi khác
  if (wazoService.hasActiveCall()) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: '⚠️ Bạn đang có một cuộc gọi khác đang hoạt động. Vui lòng kết thúc cuộc gọi trước khi gọi số mới!',
          type: 'warning',
        },
      }),
    )
    return
  }

  // Nếu đối phương đang trong cuộc gọi khác (busy) -> Chặn gọi và cảnh báo
  if (contact.status === 'busy') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🚫 [${contact.name}] hiện đang trong cuộc gọi khác (Máy bận). Vui lòng gọi lại sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // Nếu đối phương đang nhận cuộc gọi khác (ringing) -> Chặn gọi và cảnh báo
  if (contact.status === 'ringing') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🔔 [${contact.name}] hiện đang nhận một cuộc gọi khác. Vui lòng gọi lại sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // Nếu đối phương đang bật chế độ Không làm phiền (dnd) -> Cảnh báo
  if (contact.status === 'dnd') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `🔕 [${contact.name}] đang bật chế độ Không làm phiền (DND). Vui lòng liên hệ sau!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  // Nếu đối phương đang offline -> Hiển thị hộp thoại hỏi chuyển sang nhắn tin (Rule 3.2 GEMINI.md)
  if (contact.status === 'offline' || contact.status === 'unavailable') {
    const confirmMessage = confirm(
      `Máy lẻ [${contact.name} - ${contact.number}] hiện đang ngoại tuyến.\nBạn có muốn chuyển sang gửi tin nhắn không?`,
    )
    if (confirmMessage) {
      handleMessage(contact)
    }
    return
  }

  // Chuyển sang màn hình bàn phím gọi điện và tự động kích hoạt cuộc gọi với đầy đủ thông tin
  router.push({
    path: '/calls',
    query: {
      number: contact.number,
      name: contact.name,
      dept: contact.dept,
      autocall: 'true',
    },
  })
}

// 2. Nhắn tin (Chuyển sang MessagesView và mở thẳng hội thoại 1-1)
const handleMessage = (contact) => {
  contact.unreadCount = 0
  const ext = contact.number || (contact.email ? contact.email.split('@')[0] : contact.id)
  router.push({
    path: '/messages',
    query: {
      ext,
      name: contact.name,
    },
  })
}

// 3. Thông báo tính năng Gọi Video
const handleVideoCall = (contact) => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: `ℹ️ Tính năng Gọi Video hiện chưa được kích hoạt!`,
        type: 'info',
      },
    }),
  )
}

// Helper Avatar
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(-2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 65%, 48%)`
}
</script>

<style scoped>
.contacts-container {
  max-width: 1100px;
  margin: 0 auto;
}

/* Header Toolbar */
.contacts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 16px;
}

.header-left h1 {
  font-size: 1.5rem;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.sub-title {
  font-size: 0.85rem;
  color: #64748b;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-box {
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 6px 14px;
  width: 320px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.search-icon {
  font-size: 0.9rem;
  margin-right: 6px;
}

.search-input {
  border: none;
  outline: none;
  font-size: 0.9rem;
  width: 100%;
}

.btn-clear-search {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  font-size: 0.8rem;
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  background: white;
  color: #1e88e5;
  border: 1px solid #90caf9;
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-refresh:hover:not(:disabled) {
  background: #e3f2fd;
  border-color: #1e88e5;
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

/* Filter Tabs Bar */
.filter-tabs-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.tab-btn {
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.86rem;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: #f8fafc;
  border-color: #94a3b8;
}

.tab-btn.active {
  background: #1e88e5;
  color: white;
  border-color: #1e88e5;
  box-shadow: 0 2px 6px rgba(30, 136, 229, 0.25);
}

/* Table Card */
.table-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.contact-table {
  width: 100%;
  border-collapse: collapse;
}

.contact-table th {
  background: #f8fafc;
  padding: 14px 18px;
  text-align: left;
  font-size: 0.82rem;
  text-transform: uppercase;
  color: #64748b;
  font-weight: 600;
  border-bottom: 1px solid #e2e8f0;
}

.contact-table td {
  padding: 12px 18px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.contact-table tr:hover td {
  background: #f8fafc;
}

/* Star Toggle */
.btn-star {
  background: none;
  border: none;
  font-size: 1.15rem;
  cursor: pointer;
  color: #cbd5e1;
  transition: transform 0.15s, color 0.15s;
  padding: 2px;
  line-height: 1;
}

.btn-star:hover {
  transform: scale(1.25);
  color: #f59e0b;
}

.btn-star.active {
  color: #f59e0b;
}

/* User Cell */
.contact-user-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-circle {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  flex-shrink: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.user-meta {
  display: flex;
  flex-direction: column;
}

.user-hname {
  font-size: 0.92rem;
  color: #1e293b;
}

.user-email {
  font-size: 0.78rem;
  color: #64748b;
}

/* Dept Badge */
.dept-badge {
  background: #f1f5f9;
  color: #475569;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 12px;
  display: inline-block;
}

/* Ext Tag */
.ext-tag {
  background: #e0f2fe;
  color: #0284c7;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  display: inline-block;
}

/* Status Cell */
.status-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-online {
  background: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
}

.status-busy {
  background: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

.status-dnd {
  background: #f97316;
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
}

.status-away {
  background: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.status-ringing {
  background: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  animation: pulse-ring 1s infinite;
}

.status-offline {
  background: #94a3b8;
}

@keyframes pulse-ring {
  0% { transform: scale(0.95); opacity: 0.8; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(0.95); opacity: 0.8; }
}

.status-label {
  font-size: 0.82rem;
  font-weight: 500;
}

.label-online { color: #059669; }
.label-busy { color: #dc2626; font-weight: 600; }
.label-dnd { color: #ea580c; }
.label-away { color: #d97706; }
.label-ringing { color: #2563eb; font-weight: 600; }
.label-offline { color: #64748b; }

/* Action Buttons */
.action-buttons-group {
  display: inline-flex;
  gap: 6px;
  justify-content: flex-end;
}

.btn-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  transition: all 0.15s;
  position: relative;
}

.btn-icon:hover {
  transform: translateY(-2px);
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.08);
}

.btn-call {
  color: #10b981;
}

.btn-call:hover {
  background: #ecfdf5;
  border-color: #10b981;
}

.btn-msg {
  color: #3b82f6;
}

.btn-msg:hover {
  background: #eff6ff;
  border-color: #3b82f6;
}

.btn-video {
  color: #8b5cf6;
}

.btn-video:hover {
  background: #f5f3ff;
  border-color: #8b5cf6;
}

.badge-unread {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #ef4444;
  color: white;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* State Message */
.state-message {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
  background: white;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.spinner {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #1e88e5;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  animation: spin 1s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
