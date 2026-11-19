<template>
  <div class="history-container">
    <!-- Header Toolbar -->
    <div class="history-header">
      <div class="header-left">
        <h1>Lịch sử cuộc gọi</h1>
        <span class="sub-title">Nhật ký cuộc gọi thoại nội bộ (CDR)</span>
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
          <button
            v-if="filterDate"
            class="btn-clear-date"
            title="Bỏ lọc ngày"
            @click="filterDate = ''"
          >
            ✖
          </button>
        </div>

        <!-- Nút làm mới -->
        <button class="btn-refresh" title="Làm mới danh sách" @click="fetchHistory(true)">
          🔄 Làm mới
        </button>
      </div>
    </div>

    <!-- Navigation Tabs & Bộ lọc trạng thái -->
    <div class="tabs-toolbar">
      <div class="tabs-group">
        <button :class="['tab-btn', { active: currentTab === 'all' }]" @click="currentTab = 'all'">
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
    </div>

    <!-- Trạng thái Loading -->
    <div v-if="loading" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải nhật ký cuộc gọi...</p>
    </div>

    <!-- Trạng thái Không có dữ liệu -->
    <div v-else-if="filteredCalls.length === 0" class="state-message empty">
      <div class="empty-icon">🕒</div>
      <p>Không có bản ghi cuộc gọi nào phù hợp với bộ lọc.</p>
    </div>

    <!-- Danh sách cuộc gọi -->
    <div v-else class="history-list">
      <div
        v-for="call in filteredCalls"
        :key="call.id"
        class="history-card"
        :class="{
          missed: call.status === 'missed',
          'has-record': call.hasRecording || recordingsMap[call.id],
        }"
      >
        <div class="history-card-body">
          <!-- Khối Avatar người gọi -->
          <div class="avatar-box" :class="call.direction">
            <span v-if="call.direction === 'inbound'" class="direction-arrow inbound">↙</span>
            <span v-else class="direction-arrow outbound">↗</span>
            <div class="avatar-initials">{{ getInitials(call.name) }}</div>
          </div>

          <!-- Khối Thông tin chi tiết cuộc gọi -->
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
                {{
                  call.directionLabel || (call.direction === 'inbound' ? 'Incoming' : 'Outgoing')
                }}
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
          </div>
        </div>

        <!-- Thanh Audio Player mini nếu cuộc gọi có ghi âm -->
        <div v-if="call.hasRecording || recordingsMap[call.id]" class="history-player-wrapper">
          <div class="rec-badge-title">
            <span class="rec-icon">🎙️</span>
            <span class="rec-label-text">Bản ghi âm</span>
          </div>

          <div class="mini-player">
            <button
              class="player-btn-play"
              :title="currentPlayingId === call.id && isPlaying ? 'Tạm dừng' : 'Nghe ghi âm'"
              @click="togglePlayCall(call)"
            >
              <span v-if="currentPlayingId === call.id && isPlaying">⏸️</span>
              <span v-else>▶️</span>
            </button>

            <div class="player-progress-track" @click="seekCallAudio(call, $event)">
              <div
                class="player-progress-fill"
                :style="{ width: currentPlayingId === call.id ? `${playbackProgress}%` : '0%' }"
              ></div>
              <div
                class="player-progress-thumb"
                :style="{ left: currentPlayingId === call.id ? `${playbackProgress}%` : '0%' }"
              ></div>
            </div>

            <div class="player-time-text">
              {{ currentPlayingId === call.id ? formatTime(playbackCurrentTime) : '00:00' }} /
              {{
                formatTime(
                  currentPlayingId === call.id && playbackDuration
                    ? playbackDuration
                    : call.duration || 0,
                )
              }}
            </div>

            <button
              class="player-btn-download"
              title="Tải file ghi âm (.webm) về máy"
              @click="downloadCall(call)"
            >
              <span class="dl-icon">⬇️</span>
              <span class="dl-text">Tải file</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRecordingPlayer } from '../composables/useRecordingPlayer.js'
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { historyService } from '@/app/services.js'
import { contactService } from '@/app/services.js'
import { recordingService } from '@/app/services.js'
import { callState } from '@/features/calls/state/callState.js'
import { captureSessionContext, isSessionContextCurrent } from '@/core/session/sessionScope.js'

const {
  currentPlayingId,
  isPlaying,
  playbackCurrentTime,
  playbackDuration,
  playbackProgress,
  stopCurrentAudio,
  togglePlayCall,
  seekCallAudio,
  activatePlayer,
  deactivatePlayer,
} = useRecordingPlayer({
  recordingService,
  canPlay: () => !callState.activeCall && !callState.incomingCall,
})

const router = useRouter()

const loading = ref(false)
const currentTab = ref('all') // 'all' | 'incomings' | 'outgoings' | 'missed'
const searchQuery = ref('')
const filterDate = ref('')

const calls = ref([])
const recordingsMap = ref({})

let historyRequest = 0

const syncRecordingsAvailability = () => {
  try {
    const map = {}
    calls.value.forEach((c) => {
      // Xác định cuộc gọi có file ghi âm dựa trên mảng recordings từ máy chủ Wazo Call-Logd
      if (c.recordings && c.recordings.length > 0) {
        c.hasRecording = true
        map[c.id] = true
      } else if (c.hasRecording) {
        map[c.id] = true
      }
    })
    recordingsMap.value = { ...map }
  } catch (e) {}
}

const downloadCall = async (call) => {
  try {
    await recordingService.downloadRecordingForCall(call)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: '📥 Đang tải file ghi âm về máy tính...',
          type: 'success',
        },
      }),
    )
  } catch (err) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `❌ ${err.message || 'Không thể tải file ghi âm'}`,
          type: 'error',
        },
      }),
    )
  }
}

const formatTime = (seconds) => {
  if (!seconds || seconds <= 0 || isNaN(seconds)) return '00:00'
  const s = Math.floor(seconds)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

// Nạp dữ liệu từ historyService (hỗ trợ Optimistic Rendering & Force Refresh)
const fetchHistory = async (force = false) => {
  const request = ++historyRequest
  const context = captureSessionContext()
  // Optimistic rendering: nạp ngay dữ liệu cục bộ nếu calls chưa có
  if (calls.value.length === 0) {
    calls.value = historyService.getLocalHistory({ tab: 'all' })
  }
  // Bật spinner khi người dùng bấm làm mới hoặc chưa có dữ liệu nào
  if (force || calls.value.length === 0) {
    loading.value = true
  }
  try {
    const list = await historyService.getHistory({ tab: 'all', limit: 100, forceRefresh: force })
    if (request !== historyRequest || !isSessionContextCurrent(context)) return
    calls.value = [...list]
    await syncRecordingsAvailability()
  } catch (err) {
    console.error('Lỗi khi tải lịch sử cuộc gọi:', err)
  } finally {
    loading.value = false
  }
}

const onCdrUpdated = () => {
  fetchHistory(false)
}

onMounted(() => {
  fetchHistory(false)
  window.addEventListener('smartcall-cdr-updated', onCdrUpdated)
  window.addEventListener('smartcall-recording-saved', syncRecordingsAvailability)
})

onActivated(() => {
  activatePlayer()
  fetchHistory(false)
})

onDeactivated(() => {
  deactivatePlayer()
  stopCurrentAudio()
})

// Dừng phát ghi âm nếu có cuộc gọi mới phát sinh hoặc gọi đến
watch(
  () => Boolean(callState.activeCall || callState.incomingCall),
  (hasCall) => {
    if (hasCall) stopCurrentAudio()
  },
)

onUnmounted(() => {
  deactivatePlayer()
  historyRequest += 1
  stopCurrentAudio()
  window.removeEventListener('smartcall-cdr-updated', onCdrUpdated)
  window.removeEventListener('smartcall-recording-saved', syncRecordingsAvailability)
})

// Danh sách cuộc gọi đã lọc theo ngày và tìm kiếm (để số đếm counts phản ánh đúng theo ngày lọc - Mục 5)
const dateFilteredCalls = computed(() => {
  let list = calls.value
  if (filterDate.value) {
    list = list.filter((c) => c.date && c.date.startsWith(filterDate.value))
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim()
    list = list.filter(
      (c) =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.extension && c.extension.includes(q)) ||
        (c.dept && c.dept.toLowerCase().includes(q)),
    )
  }
  return list
})

// Đếm số lượng cuộc gọi theo từng tab theo đúng ngày được chọn
const counts = computed(() => {
  const list = dateFilteredCalls.value
  const all = list.length
  const incomings = list.filter((c) => c.direction === 'inbound').length
  const outgoings = list.filter((c) => c.direction === 'outbound').length
  const missed = list.filter(
    (c) => c.status === 'missed' || (c.direction === 'inbound' && !c.answered),
  ).length
  return { all, incomings, outgoings, missed }
})

// Lọc dữ liệu hiển thị theo tab
const filteredCalls = computed(() => {
  let list = dateFilteredCalls.value
  if (currentTab.value === 'incomings') {
    list = list.filter((c) => c.direction === 'inbound')
  } else if (currentTab.value === 'outgoings') {
    list = list.filter((c) => c.direction === 'outbound')
  } else if (currentTab.value === 'missed') {
    list = list.filter((c) => c.status === 'missed' || (c.direction === 'inbound' && !c.answered))
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
  const target = contactService.findContactByExtension(call.extension)
  if (target && (target.status === 'offline' || target.status === 'unavailable')) {
    const confirmMessage = confirm(
      `Máy lẻ [${target.name || call.extension}] hiện đang ngoại tuyến.\nBạn có muốn chuyển sang gửi tin nhắn không?`,
    )
    if (confirmMessage) {
      router.push({ path: '/messages', query: { ext: call.extension, name: target.name } })
    }
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

.btn-clear-search {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-clear-date {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #64748b;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75rem;
  margin-left: 2px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-clear-date:hover {
  background: #e2e8f0;
  color: #0f172a;
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

/* Tabs Toolbar */
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

/* Nút tab Active */
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

/* Danh sách cuộc gọi */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 20px;
  gap: 12px;
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.history-card.has-record {
  border-color: #cbd5e1;
}

.history-card-body {
  display: flex;
  align-items: center;
  gap: 20px;
  width: 100%;
}

.history-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.07);
  transform: translateY(-1px);
}

.history-card.missed {
  border-left: 4px solid #ef4444;
}

/* Mini Audio Player Bar */
.history-player-wrapper {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  width: 100%;
  box-sizing: border-box;
}

.rec-badge-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  font-weight: 700;
  color: #ef4444;
  white-space: nowrap;
}

.rec-icon {
  font-size: 0.95rem;
  line-height: 1;
}

.mini-player {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.player-btn-play {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  transition: all 0.2s;
  flex-shrink: 0;
}

.player-btn-play:hover {
  background: #0284c7;
  color: #ffffff;
  border-color: #0284c7;
  transform: scale(1.05);
}

.player-progress-track {
  flex: 1;
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  position: relative;
  cursor: pointer;
  min-width: 80px;
}

.player-progress-fill {
  height: 100%;
  background: #0284c7;
  border-radius: 3px;
  transition: width 0.08s linear;
}

.player-progress-thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  background: #0284c7;
  border: 2px solid #ffffff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: left 0.08s linear;
}

.player-time-text {
  font-size: 0.75rem;
  font-family: monospace;
  font-weight: 600;
  color: #64748b;
  white-space: nowrap;
  min-width: 90px;
  text-align: center;
}

.player-btn-download {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  flex-shrink: 0;
}

.player-btn-download:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #0f172a;
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

/* History Metadata */
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

@media (max-width: 768px) {
  .history-card-body {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .history-player-wrapper {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .mini-player {
    width: 100%;
  }
}
</style>
