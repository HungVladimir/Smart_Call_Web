<template>
  <div class="history-container">
    <h1>Lịch sử cuộc gọi</h1>

    <!-- Bộ lọc -->
    <div class="filters">
      <div class="filter-group">
        <label for="direction-filter">Hướng:</label>
        <select id="direction-filter" v-model="filterDirection" @change="applyFilters">
          <option value="all">Tất cả</option>
          <option value="inbound">Đến (Inbound)</option>
          <option value="outbound">Đi (Outbound)</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="date-filter">Từ ngày:</label>
        <input type="date" id="date-filter" v-model="startDate" @change="applyFilters" />
      </div>

      <button @click="loadHistoryData" class="btn-refresh">🔄 Làm mới dữ liệu</button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải lịch sử cuộc gọi...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="state-message error">
      <p>{{ error }}</p>
      <button @click="loadHistoryData" class="btn-retry">Thử lại</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredCalls.length === 0 && !loading" class="state-message empty">
      <p>Không có cuộc gọi nào phù hợp với bộ lọc.</p>
    </div>

    <!-- Responsive Call List (Thay thế Table) -->
    <div v-else class="call-list-wrapper">
      <div v-for="call in filteredCalls" :key="call.uuid" class="call-card">
        <!-- Header của Card: Thời gian & Hướng -->
        <div class="card-header">
          <span class="time-text">{{ formatTime(call.start_time) }}</span>
          <span :class="['badge', call.direction]">
            {{ getDirectionLabel(call.direction) }}
          </span>
        </div>

        <!-- Body của Card: Thông tin chính -->
        <div class="card-body">
          <div class="info-row">
            <div class="info-item">
              <span class="label">Đối tượng:</span>
              <span class="value name">{{ call.remote_name || 'Ẩn danh' }}</span>
            </div>
            <div class="info-item">
              <span class="label">Số máy:</span>
              <span class="value number">{{ call.extension || call.remote_number || '-' }}</span>
            </div>
          </div>

          <div class="info-row bottom-row">
            <div class="info-item">
              <span class="label">Thời lượng:</span>
              <span class="value duration">{{ formatDuration(call.duration) }}</span>
            </div>
            <div class="info-item status-item">
              <span :class="['status-dot', call.answered ? 'answered' : 'missed']"></span>
              <span class="value status-text">{{ call.answered ? 'Đã nghe' : 'Nhỡ' }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const filterDirection = ref('all')
const startDate = ref('')
const loading = ref(false)
const error = ref('')

// Mock Data giả lập từ API Call Log
const rawCalls = ref([
  {
    uuid: 'cdr-001',
    start_time: new Date().toISOString(),
    remote_name: 'Alice Nguyễn',
    extension: '1001',
    direction: 'inbound',
    duration: 125,
    answered: true,
  },
  {
    uuid: 'cdr-002',
    start_time: new Date(Date.now() - 3600000).toISOString(),
    remote_name: null,
    extension: '1002',
    direction: 'outbound',
    duration: 45,
    answered: true,
  },
  {
    uuid: 'cdr-003',
    start_time: new Date(Date.now() - 7200000).toISOString(),
    remote_name: 'Bob Trần',
    extension: '1003',
    direction: 'inbound',
    duration: 0,
    answered: false,
  },
  {
    uuid: 'cdr-004',
    start_time: new Date(Date.now() - 86400000).toISOString(),
    remote_name: 'Carol Lê',
    extension: '1004',
    direction: 'outbound',
    duration: 300,
    answered: true,
  },
])

const filteredCalls = computed(() => {
  let result = rawCalls.value

  if (filterDirection.value !== 'all') {
    result = result.filter((c) => c.direction === filterDirection.value)
  }

  if (startDate.value) {
    const start = new Date(startDate.value)
    start.setHours(0, 0, 0, 0)

    result = result.filter((c) => {
      const callDate = new Date(c.start_time)
      return callDate >= start
    })
  }

  return result.sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
})

onMounted(() => {
  loadHistoryData()
})

const loadHistoryData = async () => {
  loading.value = true
  error.value = ''

  try {
    await new Promise((resolve) => setTimeout(resolve, 500))
    console.log('Đã tải lịch sử cuộc gọi')
  } catch (err) {
    console.error('Lỗi tải lịch sử:', err)
    error.value = 'Không thể tải lịch sử cuộc gọi từ server.'
  } finally {
    loading.value = false
  }
}

const applyFilters = () => {
  // Computed property tự động cập nhật
}

const formatTime = (isoString) => {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatDuration = (seconds) => {
  if (!seconds || seconds === 0) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

const getDirectionLabel = (dir) => {
  switch (dir) {
    case 'inbound':
      return 'Đến'
    case 'outbound':
      return 'Đi'
    default:
      return dir
  }
}
</script>

<style scoped>
/* --- Container chung --- */
.history-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #333;
}

h1 {
  color: #2c3e50;
  margin-bottom: 20px;
  font-size: 1.5rem;
}

/* --- Filters --- */
.filters {
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap; /* Cho phép xuống dòng trên mobile */
  background: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  margin-bottom: 20px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group label {
  font-weight: 500;
  color: #34495e;
  white-space: nowrap;
}

select,
input[type='date'] {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
  background-color: #fff;
}

.btn-refresh {
  background: #3498db;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
  margin-left: auto; /* Đẩy nút về cuối nếu có chỗ */
}

.btn-refresh:hover {
  background: #2980b9;
}

/* --- Call List (Responsive替代Table) --- */
.call-list-wrapper {
  display: grid;
  gap: 15px;
  /* Desktop: Có thể chia cột nếu muốn, nhưng list dọc thường dễ đọc hơn với nhiều dữ liệu */
  grid-template-columns: 1fr;
}

.call-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  border-left: 4px solid transparent; /* Dấu hiệu màu sắc bên trái */
}

.call-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

/* Thêm màu viền trái dựa trên hướng */
.call-card.inbound {
  border-left-color: #2ecc71;
}
.call-card.outbound {
  border-left-color: #3498db;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 15px;
  background-color: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.time-text {
  font-weight: 600;
  color: #2c3e50;
  font-size: 0.95rem;
}

.badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.badge.inbound {
  background-color: #2ecc71;
}

.badge.outbound {
  background-color: #3498db;
}

.card-body {
  padding: 15px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.label {
  font-size: 0.85rem;
  color: #7f8c8d;
  font-weight: 500;
}

.value {
  font-size: 0.95rem;
  color: #2c3e50;
  font-weight: 500;
}

.value.name {
  font-weight: 600;
}

.value.number {
  font-family: monospace; /* Giúp số dễ đọc hơn */
}

.bottom-row {
  align-items: center;
}

.status-item {
  margin-left: auto; /* Đẩy trạng thái về bên phải */
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.answered {
  background-color: #2ecc71;
  box-shadow: 0 0 4px rgba(46, 204, 113, 0.4);
}

.status-dot.missed {
  background-color: #e74c3c;
  box-shadow: 0 0 4px rgba(231, 76, 60, 0.4);
}

.status-text {
  font-size: 0.85rem;
  font-weight: 600;
}

.status-text.answered {
  color: #27ae60;
}
.status-text.missed {
  color: #c0392b;
}

/* --- States (Loading, Error, Empty) --- */
.state-message {
  text-align: center;
  padding: 40px;
  color: #7f8c8d;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.state-message.error {
  color: #e74c3c;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin: 0 auto 10px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.btn-retry {
  margin-top: 10px;
  padding: 8px 15px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

/* --- RESPONSIVE BREAKPOINTS --- */

/* Tablet và Mobile (< 768px) */
@media (max-width: 768px) {
  .history-container {
    padding: 15px;
  }

  h1 {
    font-size: 1.25rem;
  }

  .filters {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .filter-group {
    width: 100%;
  }

  select,
  input[type='‘date’'] {
    width: 100%;
  }

  .btn-refresh {
    width: 100%;
    margin-left: 0;
    text-align: center;
  }

  /* Điều chỉnh card trên mobile cho dễ nhìn */
  .card-body {
    padding: 12px;
  }

  .info-row {
    flex-direction: column;
    gap: 5px;
  }

  .bottom-row {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed #eee;
  }

  .status-item {
    margin-left: 0;
    justify-content: flex-start;
  }
}

/* Màn hình rất nhỏ (< 480px) */
@media (max-width: 480px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .badge {
    align-self: flex-start;
  }
}
</style>