<template>
  <div class="history-container">
    <!-- Header Toolbar -->
    <div class="history-header">
      <div class="header-left">
        <h1>Lịch sử cuộc gọi</h1>
        <span class="sub-title">Nhật ký thoại nội bộ Wazo Call-Logd (CDR)</span>
      </div>

      <div class="header-filters">
        <!-- Ô tìm kiếm -->
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Tìm theo tên, máy lẻ hoặc phòng ban..."
            class="search-input"
          />
          <button v-if="searchQuery" class="btn-clear-search" @click="searchQuery = ''">✖</button>
        </div>

        <!-- Lọc từ ngày -->
        <div class="date-filter-box">
          <label>Từ ngày:</label>
          <input v-model="filterDate" type="date" class="date-input" />
          <button v-if="filterDate" class="btn-clear-date" title="Bỏ lọc ngày" @click="filterDate = ''">✖</button>
        </div>

        <!-- Nút làm mới -->
        <button class="btn-refresh" title="Làm mới danh sách" @click="fetchHistory">
          🔄 Làm mới
        </button>
      </div>
    </div>

    <!-- Navigation Tabs chuẩn web1.webp & Nút Xóa lịch sử -->
    <div class="tabs-toolbar">
      <div class="tabs-group">
        <button
          :class="['tab-btn', { active: currentTab === 'all' }]"
          @click="currentTab = 'all'"
        >
          ALL <span class="tab-badge">{{ counts.all }}</span>
        </button>

        <button
          :class="['tab-btn', { active: currentTab === 'incomings' }]"
          @click="currentTab = 'incomings'"
        >
          INCOMINGS <span class="tab-badge">{{ counts.incomings }}</span>
        </button>

        <button
          :class="['tab-btn', { active: currentTab === 'outgoings' }]"
          @click="currentTab = 'outgoings'"
        >
          OUTGOINGS <span class="tab-badge">{{ counts.outgoings }}</span>
        </button>

        <button
          :class="['tab-btn', { active: currentTab === 'missed' }]"
          @click="currentTab = 'missed'"
        >
          MISSED <span class="tab-badge danger">{{ counts.missed }}</span>
        </button>
      </div>

      <!-- Nút DELETE HISTORY theo đúng giao diện web1.webp -->
      <button
        class="btn-delete-history"
        :disabled="calls.length === 0"
        @click="showConfirmDeleteAll = true"
      >
        🗑️ DELETE HISTORY
      </button>
    </div>

    <!-- Trạng thái Loading -->
    <div v-if="loading" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải nhật ký cuộc gọi từ Wazo CDR...</p>
    </div>

    <!-- Trạng thái Không có dữ liệu -->
    <div v-else-if="filteredCalls.length === 0" class="state-message empty">
      <div class="empty-icon">🕒</div>
      <p>Không có bản ghi cuộc gọi nào phù hợp với bộ lọc.</p>
    </div>

    <!-- Danh sách cuộc gọi theo chuẩn web1.webp -->
    <div v-else class="history-list">
      <div
        v-for="call in filteredCalls"
        :key="call.id"
        class="history-card"
        :class="{ missed: call.status === 'missed' }"
      >
        <!-- Khối Avatar người gọi (Hình hộp vuông/tròn theo web1.webp) -->
        <div class="avatar-box" :class="call.direction">
          <span v-if="call.direction === 'inbound'" class="direction-arrow inbound">↙</span>
          <span v-else class="direction-arrow outbound">↗</span>
          <div class="avatar-initials">{{ getInitials(call.name) }}</div>
        </div>

        <!-- Khối Thông tin chi tiết cuộc gọi (Theo mẫu chuẩn web1.webp) -->
        <div class="history-meta">
          <div class="meta-line">
            <span class="meta-label">Date:</span>
            <strong class="meta-value date-val">{{ call.date }}</strong>
          </div>
          <div class="meta-line">
            <span class="meta-label">Duration:</span>
            <span class="meta-value duration-val">{{ formatDuration(call.duration) }}</span>
          </div>
          <div class="meta-line">
            <span class="meta-label">Direction:</span>
            <span :class="['direction-tag', call.direction]">
              {{ call.directionLabel || (call.direction === 'inbound' ? 'Incoming' : 'Outgoing') }}
            </span>
          </div>
          <div class="meta-line">
            <span class="meta-label">Status:</span>
            <span :class="['status-tag', call.status]">
              {{ call.statusLabel || (call.answered ? 'Success' : 'Missed') }}
            </span>
          </div>
        </div>

        <!-- Khối Tên nhân viên & Máy lẻ nội bộ -->
        <div class="contact-info">
          <div class="contact-name">{{ call.name || 'Số ngoài mạng' }}</div>
          <div class="contact-ext">
            <span class="ext-badge">Máy lẻ {{ call.extension || '---' }}</span>
          </div>
          <div class="contact-dept">{{ call.dept || 'Nội bộ SDV LAN' }}</div>
        </div>

        <!-- Các nút thao tác nhanh -->
        <div class="history-actions">
          <!-- 📞 Nút Gọi lại nhanh -->
          <button
            class="btn-action btn-callback"
            title="Gọi lại ngay"
            @click="handleCallback(call)"
          >
            <span class="action-icon">📞</span>
            <span class="action-text">Gọi lại</span>
          </button>

          <!-- 💬 Nút Nhắn tin -->
          <button
            class="btn-action btn-chat"
            title="Nhắn tin với nhân viên này"
            @click="handleChat(call)"
          >
            <span class="action-icon">💬</span>
          </button>

          <!-- ❌ Nút Xóa bản ghi này -->
          <button
            class="btn-action btn-delete-item"
            title="Xóa bản ghi này"
            @click="handleDeleteItem(call)"
          >
            <span class="action-icon">✖</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modal Xác nhận Xóa toàn bộ lịch sử -->
    <div v-if="showConfirmDeleteAll" class="modal-backdrop" @click.self="showConfirmDeleteAll = false">
      <div class="confirm-modal">
        <div class="modal-icon danger">⚠️</div>
        <h3>Xác nhận xóa lịch sử cuộc gọi</h3>
        <p>Bạn có chắc chắn muốn xóa toàn bộ lịch sử cuộc gọi không? Thao tác này sẽ xóa sạch nhật ký cuộc gọi khỏi hệ thống và không thể hoàn tác.</p>
        <div class="modal-actions">
          <button class="btn-cancel" @click="showConfirmDeleteAll = false">Hủy bỏ</button>
          <button class="btn-confirm-delete" @click="confirmDeleteAll">Xác nhận xóa hết</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { historyService } from '@/services/historyService'

const router = useRouter()

const loading = ref(false)
const currentTab = ref('all') // 'all' | 'incomings' | 'outgoings' | 'missed'
const searchQuery = ref('')
const filterDate = ref('')
const showConfirmDeleteAll = ref(false)

const calls = ref([])

// Nạp dữ liệu từ historyService
const fetchHistory = async () => {
  loading.value = true
  try {
    calls.value = await historyService.getHistory({ tab: 'all', limit: 100 })
  } catch (err) {
    console.error('Lỗi khi tải lịch sử cuộc gọi:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchHistory()
})

// Đếm số lượng cuộc gọi theo từng tab
const counts = computed(() => {
  const all = calls.value.length
  const incomings = calls.value.filter((c) => c.direction === 'inbound').length
  const outgoings = calls.value.filter((c) => c.direction === 'outbound').length
  const missed = calls.value.filter((c) => c.status === 'missed' || !c.answered).length
  return { all, incomings, outgoings, missed }
})

// Lọc dữ liệu theo tab, từ khóa tìm kiếm và ngày tháng
const filteredCalls = computed(() => {
  let list = calls.value

  // 1. Lọc theo Tab
  if (currentTab.value === 'incomings') {
    list = list.filter((c) => c.direction === 'inbound')
  } else if (currentTab.value === 'outgoings') {
    list = list.filter((c) => c.direction === 'outbound')
  } else if (currentTab.value === 'missed') {
    list = list.filter((c) => c.status === 'missed' || !c.answered)
  }

  // 2. Lọc theo từ khóa tìm kiếm (tên, số máy, phòng ban)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim()
    list = list.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.extension && c.extension.includes(q)) ||
        (c.dept && c.dept.toLowerCase().includes(q)),
    )
  }

  // 3. Lọc theo ngày (Từ ngày)
  if (filterDate.value) {
    list = list.filter((c) => c.date && c.date.startsWith(filterDate.value))
  }

  return list
})

// Format thời lượng cuộc gọi mm:ss
const formatDuration = (seconds) => {
  return historyService.formatDuration(seconds)
}

// Lấy 2 chữ cái đầu cho Avatar
const getInitials = (name) => {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Thao tác Gọi lại nhanh (Callback): Điều hướng sang màn hình /calls và kích hoạt gọi
const handleCallback = (call) => {
  if (!call.extension) {
    alert('Không tìm thấy số máy lẻ để gọi lại!')
    return
  }
  router.push({
    path: '/calls',
    query: {
      number: call.extension,
      autocall: 'true',
    },
  })
}

// Thao tác Nhắn tin: Điều hướng sang MessagesView
const handleChat = (call) => {
  router.push({
    path: '/messages',
    query: {
      name: call.name,
      ext: call.extension,
    },
  })
}

// Thao tác Xóa 1 bản ghi
const handleDeleteItem = async (call) => {
  const ok = confirm(`Bạn có chắc chắn muốn xóa bản ghi cuộc gọi của ${call.name || call.extension}?`)
  if (!ok) return
  await historyService.deleteItem(call.id)
  await fetchHistory()
}

// Thao tác Xóa toàn bộ lịch sử (DELETE HISTORY)
const confirmDeleteAll = async () => {
  await historyService.clearAllHistory()
  showConfirmDeleteAll.value = false
  await fetchHistory()
}
</script>

<style scoped>
.history-container {
  padding: 0;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header & Filters */
.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.header-left h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.sub-title {
  font-size: 0.875rem;
  color: #64748b;
}

.header-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  font-size: 0.85rem;
  color: #94a3b8;
}

.search-input {
  width: 280px;
  padding: 9px 36px 9px 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.875rem;
  outline: none;
  background-color: #fff;
  transition: all 0.2s;
}

.search-input:focus {
  border-color: #0284c7;
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
}

.btn-clear-search,
.btn-clear-date {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.8rem;
}

.date-filter-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #475569;
}

.date-input {
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.85rem;
  background: #fff;
  outline: none;
}

.btn-refresh {
  padding: 9px 14px;
  background-color: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  color: #334155;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover {
  background-color: #e2e8f0;
  border-color: #94a3b8;
}

/* Tabs Toolbar chuẩn web1.webp */
.tabs-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.tabs-group {
  display: flex;
  gap: 4px;
}

.tab-btn {
  padding: 9px 18px;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  border: none;
  background: transparent;
  color: #64748b;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: #e2e8f0;
  color: #1e293b;
}

/* Nút tab Active có màu xanh đậm chuẩn web1.webp */
.tab-btn.active {
  background-color: #0284c7;
  color: #ffffff;
  box-shadow: 0 2px 6px rgba(2, 132, 199, 0.3);
}

.tab-badge {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.1);
  font-weight: 600;
}

.tab-btn.active .tab-badge {
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
}

.tab-badge.danger {
  background: #fee2e2;
  color: #ef4444;
}

.tab-btn.active .tab-badge.danger {
  background: #ef4444;
  color: #fff;
}

/* Nút DELETE HISTORY chuẩn theo ảnh web1.webp */
.btn-delete-history {
  padding: 9px 18px;
  background-color: #334155;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.btn-delete-history:hover:not(:disabled) {
  background-color: #dc2626;
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);
}

.btn-delete-history:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Danh sách cuộc gọi */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-card {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 20px;
  gap: 20px;
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.history-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.07);
  transform: translateY(-1px);
}

.history-card.missed {
  border-left: 4px solid #ef4444;
}

/* Avatar Box */
.avatar-box {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  background-color: #334155;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
}

.avatar-box.inbound {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
}

.avatar-box.outbound {
  background: linear-gradient(135deg, #6366f1, #4f46e5);
}

.history-card.missed .avatar-box {
  background: linear-gradient(135deg, #f87171, #ef4444);
}

.avatar-initials {
  font-size: 0.95rem;
  font-weight: 700;
}

.direction-arrow {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
}

.direction-arrow.inbound {
  background-color: #10b981;
  color: #fff;
}

.direction-arrow.outbound {
  background-color: #3b82f6;
  color: #fff;
}

/* History Metadata theo chuẩn web1.webp */
.history-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  row-gap: 3px;
  column-gap: 8px;
  min-width: 240px;
  font-size: 0.85rem;
}

.meta-line {
  display: contents;
}

.meta-label {
  color: #64748b;
  font-weight: 500;
}

.meta-value {
  color: #1e293b;
}

.date-val {
  font-family: monospace;
  font-size: 0.85rem;
}

.duration-val {
  font-weight: 600;
  color: #0284c7;
}

.direction-tag {
  font-weight: 600;
  text-transform: capitalize;
}

.direction-tag.inbound {
  color: #059669;
}

.direction-tag.outbound {
  color: #2563eb;
}

.status-tag {
  font-weight: 600;
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  width: fit-content;
}

.status-tag.success {
  background: #dcfce7;
  color: #15803d;
}

.status-tag.missed {
  background: #fee2e2;
  color: #dc2626;
}

.status-tag.declined {
  background: #fef3c7;
  color: #d97706;
}

/* Contact Info Column */
.contact-info {
  flex: 1;
  padding: 0 10px;
}

.contact-name {
  font-size: 1rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 4px;
}

.contact-ext {
  margin-bottom: 4px;
}

.ext-badge {
  display: inline-block;
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #0284c7;
}

.contact-dept {
  font-size: 0.8rem;
  color: #64748b;
}

/* History Actions */
.history-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-action {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.btn-callback {
  background-color: #ecfdf5;
  color: #059669;
  border-color: #a7f3d0;
}

.btn-callback:hover {
  background-color: #059669;
  color: #fff;
  border-color: #059669;
}

.btn-chat {
  background-color: #f0f9ff;
  color: #0284c7;
  border-color: #bae6fd;
  padding: 8px 12px;
}

.btn-chat:hover {
  background-color: #0284c7;
  color: #fff;
}

.btn-delete-item {
  background-color: #f8fafc;
  color: #94a3b8;
  border-color: #e2e8f0;
  padding: 8px 10px;
}

.btn-delete-item:hover {
  background-color: #fee2e2;
  color: #dc2626;
  border-color: #fca5a5;
}

/* Loading & Empty States */
.state-message {
  text-align: center;
  padding: 60px 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #0284c7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 12px;
}

/* Confirm Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 90%;
  max-width: 440px;
  text-align: center;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.modal-icon.danger {
  font-size: 2.5rem;
  margin-bottom: 12px;
}

.confirm-modal h3 {
  font-size: 1.25rem;
  color: #1e293b;
  margin: 0 0 10px 0;
}

.confirm-modal p {
  font-size: 0.9rem;
  color: #64748b;
  line-height: 1.5;
  margin-bottom: 24px;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn-cancel {
  padding: 10px 20px;
  background-color: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.btn-cancel:hover {
  background-color: #e2e8f0;
}

.btn-confirm-delete {
  padding: 10px 20px;
  background-color: #dc2626;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  color: #ffffff;
  cursor: pointer;
}

.btn-confirm-delete:hover {
  background-color: #b91c1c;
}
</style>
