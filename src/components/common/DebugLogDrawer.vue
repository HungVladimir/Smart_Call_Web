<template>
  <div class="debug-logger-container">
    <!-- Nút mở bảng nhật ký nổi ở góc phải bên dưới -->
    <button
      v-if="!isOpen"
      class="btn-floating-logger"
      @click="isOpen = true"
      title="Mở bảng Nhật ký Thao tác & Sự kiện WebRTC thời gian thực"
    >
      <span class="log-icon">📋</span>
      <span class="log-text">Logs</span>
      <span v-if="logs.length > 0" class="log-badge">{{ logs.length }}</span>
    </button>

    <!-- Bảng Drawer Nhật ký Console -->
    <transition name="drawer-slide">
      <div v-if="isOpen" class="debug-drawer">
        <!-- Header của Drawer -->
        <div class="drawer-header">
          <div class="drawer-title">
            <span class="title-icon">📋</span>
            <span class="title-text">NHẬT KÝ THAO TÁC & SỰ KIỆN WEBRTC (LIVE DEBUG)</span>
            <span class="log-count">({{ filteredLogs.length }} dòng)</span>
          </div>

          <div class="drawer-actions">
            <button class="btn-action" @click="handleCopy" title="Sao chép toàn bộ nhật ký ra clipboard">
              📋 Sao chép
            </button>
            <button class="btn-action" @click="handleClear" title="Xóa sạch nhật ký hiện tại">
              🗑️ Xóa
            </button>
            <button class="btn-close-drawer" @click="isOpen = false" title="Đóng bảng nhật ký">
              ✖
            </button>
          </div>
        </div>

        <!-- Thanh lọc danh mục Log -->
        <div class="drawer-filters">
          <button
            v-for="cat in categories"
            :key="cat.key"
            class="btn-filter"
            :class="{ active: selectedCategory === cat.key }"
            @click="selectedCategory = cat.key"
          >
            {{ cat.label }}
          </button>
        </div>

        <!-- Khung hiển thị danh sách dòng Log -->
        <div class="drawer-body" ref="logContainerRef">
          <div v-if="filteredLogs.length === 0" class="empty-logs">
            Chưa có sự kiện nào trong danh mục này. Hãy thao tác trên web để xem log tự động!
          </div>

          <div
            v-for="log in filteredLogs"
            :key="log.id"
            class="log-row"
            :class="`level-${log.level}`"
          >
            <span class="log-time">{{ log.time }}</span>
            <span class="log-category" :class="`cat-${log.category.toLowerCase()}`">
              [{{ log.category }}]
            </span>
            <span class="log-msg">{{ log.message }}</span>
            <span v-if="log.details" class="log-details">
              {{ typeof log.details === 'object' ? JSON.stringify(log.details) : log.details }}
            </span>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { logger } from '@/services/loggerService'

const isOpen = ref(false)
const selectedCategory = ref('ALL')
const logContainerRef = ref(null)

const logs = ref(logger.getLogs())

const categories = [
  { key: 'ALL', label: 'TẤT CẢ' },
  { key: 'CALL', label: '📞 CUỘC GỌI' },
  { key: 'SIP', label: '🌐 SIP WEBRTC' },
  { key: 'AUTH', label: '🔒 XÁC THỰC' },
  { key: 'API', label: '📡 REST API' },
  { key: 'UI', label: '🖱️ THAO TÁC' },
  { key: 'AUDIO', label: '🔊 ÂM THANH' },
]

const filteredLogs = computed(() => {
  if (selectedCategory.value === 'ALL') {
    return logs.value
  }
  return logs.value.filter((l) => l.category === selectedCategory.value)
})

const onLogAdded = () => {
  logs.value = [...logger.getLogs()]
  if (isOpen.value) {
    nextTick(() => {
      if (logContainerRef.value) {
        logContainerRef.value.scrollTop = 0
      }
    })
  }
}

const onLogsCleared = () => {
  logs.value = []
}

onMounted(() => {
  window.addEventListener('smartcall-log-added', onLogAdded)
  window.addEventListener('smartcall-logs-cleared', onLogsCleared)
})

onUnmounted(() => {
  window.removeEventListener('smartcall-log-added', onLogAdded)
  window.removeEventListener('smartcall-logs-cleared', onLogsCleared)
})

const handleClear = () => {
  logger.clearLogs()
}

const handleCopy = async () => {
  const text = logger.exportLogsText()
  try {
    await navigator.clipboard.writeText(text)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: '📋 Đã sao chép toàn bộ nhật ký vào Clipboard!', type: 'success' },
      }),
    )
  } catch (e) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: 'Không thể sao chép nhật ký', type: 'error' },
      }),
    )
  }
}
</script>

<style scoped>
.debug-logger-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9990;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* Nút mở nổi */
.btn-floating-logger {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #0f172a;
  color: #f8fafc;
  border: 1px solid #334155;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  padding: 8px 14px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.btn-floating-logger:hover {
  background: #1e293b;
  border-color: #3b82f6;
  transform: translateY(-2px);
}

.log-icon {
  font-size: 0.95rem;
}

.log-badge {
  background: #ef4444;
  color: white;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.72rem;
}

/* Khung Drawer */
.debug-drawer {
  width: 580px;
  max-width: 90vw;
  height: 380px;
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
}

.drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.5px;
}

.log-count {
  font-size: 0.74rem;
  color: #64748b;
}

.drawer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-action {
  background: #334155;
  color: #e2e8f0;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.74rem;
  cursor: pointer;
  transition: background 0.15s;
}

.btn-action:hover {
  background: #475569;
}

.btn-close-drawer {
  background: transparent;
  color: #94a3b8;
  border: none;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 2px 6px;
}

.btn-close-drawer:hover {
  color: #ef4444;
}

/* Dải nút bộ lọc */
.drawer-filters {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
  overflow-x: auto;
}

.btn-filter {
  background: transparent;
  color: #94a3b8;
  border: 1px solid #334155;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  cursor: pointer;
  white-space: nowrap;
}

.btn-filter.active,
.btn-filter:hover {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}

/* Nội dung Log */
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.74rem;
  line-height: 1.45;
}

.empty-logs {
  color: #64748b;
  text-align: center;
  margin-top: 40px;
  font-style: italic;
}

.log-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  border-left: 3px solid #64748b;
}

.log-time {
  color: #64748b;
  font-size: 0.72rem;
}

.log-category {
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.68rem;
}

.cat-call {
  background: #7c3aed;
  color: white;
}
.cat-sip {
  background: #059669;
  color: white;
}
.cat-auth {
  background: #2563eb;
  color: white;
}
.cat-audio {
  background: #d97706;
  color: white;
}
.cat-api {
  background: #0284c7;
  color: white;
}
.cat-ui {
  background: #475569;
  color: white;
}
.cat-system {
  background: #334155;
  color: white;
}

.log-msg {
  color: #f1f5f9;
  word-break: break-word;
}

.log-details {
  color: #94a3b8;
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 4px;
  border-radius: 3px;
  width: 100%;
}

.level-success {
  border-left-color: #22c55e;
}
.level-warn {
  border-left-color: #f59e0b;
}
.level-error {
  border-left-color: #ef4444;
}

/* Hiệu ứng trượt */
.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: all 0.25s ease-out;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.96);
}
</style>

