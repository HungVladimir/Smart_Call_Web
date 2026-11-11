<template>
  <div
    class="call-panel"
    :class="{
      incoming: isIncoming,
      active: isActive,
      minimized: isMinimized,
    }"
  >
    <!-- Header Panel (Nhấp để thu nhỏ/mở rộng) -->
    <div class="panel-header" @click="toggleMinimize">
      <div class="status-indicator" :class="panelStatusClass"></div>
      <span class="panel-title">{{ panelTitle }}</span>
      <button class="btn-minimize" title="{{ isMinimized ? 'Mở rộng' : 'Thu nhỏ' }}">
        {{ isMinimized ? '▲' : '▼' }}
      </button>
    </div>

    <!-- Nội dung Panel (Ẩn khi thu nhỏ) -->
    <div v-show="!isMinimized" class="panel-body">
      <!-- Trạng thái 1: Chưa kết nối tổng đài -->
      <div v-if="phoneStatus === 'disconnected'" class="state disconnected">
        <div class="icon">⚠️</div>
        <p>Chưa kết nối Wazo Server</p>
        <small>Vui lòng kiểm tra mạng hoặc SSL</small>
      </div>

      <!-- Trạng thái 2: Đang kết nối -->
      <div v-else-if="phoneStatus === 'connecting'" class="state connecting">
        <div class="spinner"></div>
        <p>Đang kết nối đến tổng đài...</p>
      </div>

      <!-- Trạng thái 3: Đã kết nối, sẵn sàng gọi (Idle) -->
      <div v-else-if="!hasActiveCall" class="state idle">
        <div class="avatar idle-avatar">👤</div>
        <h3>Sẵn sàng gọi điện</h3>
        <p>Nhập số máy lẻ bên dưới để thực hiện cuộc gọi đi.</p>

        <div class="dialer-input">
          <input
            v-model="localExtension"
            placeholder="VD: 1002"
            type="tel"
            maxlength="6"
            @keyup.enter="makeCall"
            class="extension-input"
          />
          <button @click="makeCall" class="btn-call-action">Gọi</button>
        </div>
      </div>

      <!-- Trạng thái 4: Có cuộc gọi (Incoming hoặc Active) -->
      <div v-else class="state active-call">
        <!-- Thông tin cuộc gọi -->
        <div class="call-info">
          <div class="avatar call-avatar" :style="{ backgroundColor: getAvatarColor(callName) }">
            {{ getInitials(callName) }}
          </div>
          <div class="call-details">
            <h3>{{ callName }}</h3>
            <p class="duration">{{ duration }}s</p>
            <p class="direction">{{ directionLabel }}</p>
          </div>
        </div>

        <!-- Nút điều khiển -->
        <div class="controls">
          <!-- Nếu đang đổ chuông (Incoming) -->
          <template v-if="isIncoming">
            <button @click="$emit('reject')" class="btn btn-reject" title="Từ chối">
              ✖ Từ chối
            </button>
            <button @click="$emit('accept')" class="btn btn-accept" title="Nghe máy">
              📞 Nghe máy
            </button>
          </template>

          <!-- Nếu đang gọi/nói chuyện (Outgoing/Talking/Held) -->
          <template v-else>
            <div class="control-group">
              <button @click="$emit('mute')" :class="{ active: isMuted }" title="Bật/Tắt Mic">
                {{ isMuted ? '🔇' : '🎙️' }}
              </button>

              <button @click="$emit('hold')" :class="{ active: isHeld }" title="Giữ máy">
                {{ isHeld ? '▶️' : '⏸️' }}
              </button>
            </div>

            <button @click="$emit('hangup')" class="btn btn-hangup" title="Cúp máy">
              📵 Cúp máy
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  currentCall: Object,
  phoneStatus: String, // 'disconnected', 'connecting', 'connected', 'error'
})

const emit = defineEmits(['hangup', 'accept', 'reject', 'mute', 'hold', 'dial'])

// State cho bàn phím quay số
const localExtension = ref('')

// State cho việc thu nhỏ panel
const isMinimized = ref(false)

// --- Computed Properties ---

const hasActiveCall = computed(() => !!props.currentCall)
const isIncoming = computed(() => props.currentCall?.state === 'incoming')
const isActive = computed(() =>
  ['ringing', 'progressing', 'talking', 'held'].includes(props.currentCall?.state),
)

// Trạng thái hiển thị trên header
const panelStatusClass = computed(() => {
  if (!hasActiveCall.value && !isActive.value) return 'idle'
  if (isIncoming.value) return 'ringing'
  if (isHeld.value) return 'held'
  return 'talking'
})

const panelTitle = computed(() => {
  if (props.phoneStatus === 'disconnected') return 'Wazo: Disconnected'
  if (props.phoneStatus === 'connecting') return 'Wazo: Connecting...'
  if (hasActiveCall.value) return 'Wazo: Active Call'
  return 'Wazo: Ready'
})

// Thông tin cuộc gọi
const callName = computed(() => {
  if (!props.currentCall) return ''
  // Ưu tiên remote_name, nếu không có thì lấy extension
  return props.currentCall.remote_name || props.currentCall.extension || 'Ẩn danh'
})

const directionLabel = computed(() => {
  if (!props.currentCall) return ''
  switch (props.currentCall.call_direction) {
    case 'inbound':
      return 'Cuộc gọi đến'
    case 'outbound':
      return 'Cuộc gọi đi'
    default:
      return ''
  }
})

const isMuted = computed(() => props.currentCall?.local_muted || false)
const isHeld = computed(() => props.currentCall?.local_held || false)

// Thời gian gọi
const duration = ref(0)
let timer = null

watch(
  () => props.currentCall,
  (newCall) => {
    if (newCall && ['talking', 'ringing', 'progressing'].includes(newCall.state)) {
      duration.value = 0
      timer = setInterval(() => {
        duration.value++
      }, 1000)
    } else {
      clearInterval(timer)
    }
  },
  { immediate: true },
)

// --- Methods ---

const toggleMinimize = () => {
  isMinimized.value = !isMinimized.value
}

const makeCall = () => {
  if (localExtension.value.trim()) {
    emit('dial', localExtension.value.trim())
    localExtension.value = '' // Reset sau khi gọi
  }
}

// Helper UI
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 70%, 60%)`
}
</script>

<style scoped>
/* Container chính */
.call-panel {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 320px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  z-index: 1000;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}

.call-panel.minimized {
  width: auto;
  min-width: 150px;
}

/* Header Panel */
.panel-header {
  background: #f8f9fa;
  padding: 10px 15px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
  user-select: none;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.idle {
  background: #bdc3c7;
}
.ringing {
  background: #e74c3c;
  animation: blink 1s infinite;
}
.talking {
  background: #2ecc71;
}
.held {
  background: #f39c12;
}

@keyframes blink {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
  100% {
    opacity: 1;
  }
}

.panel-title {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 600;
  color: #2c3e50;
}

.btn-minimize {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  color: #7f8c8d;
}

/* Body Panel */
.panel-body {
  padding: 20px;
  text-align: center;
}

/* Các trạng thái chung */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.icon {
  font-size: 2rem;
  margin-bottom: 5px;
}
p {
  color: #7f8c8d;
  font-size: 0.9rem;
  margin: 0;
}
small {
  color: #95a5a6;
  font-size: 0.8rem;
}

/* Spinner */
.spinner {
  width: 30px;
  height: 30px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 10px 0;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* Avatar */
.avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  margin-bottom: 10px;
  color: white;
  font-weight: bold;
}

.idle-avatar {
  background: #3498db;
}
.call-avatar {
  font-size: 1.2rem;
}

/* Dialer Input */
.dialer-input {
  display: flex;
  gap: 5px;
  width: 100%;
  margin-top: 10px;
}

.extension-input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 1rem;
  text-align: center;
}

.extension-input:focus {
  outline: none;
  border-color: #3498db;
}

.btn-call-action {
  background: #2ecc71;
  color: white;
  border: none;
  padding: 10px 15px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.btn-call-action:hover {
  background: #27ae60;
}

/* Controls */
.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin-top: 15px;
}

.control-group {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.btn {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: background 0.2s;
}

.btn-accept {
  background: #2ecc71;
  color: white;
}
.btn-accept:hover {
  background: #27ae60;
}

.btn-reject {
  background: #e74c3c;
  color: white;
}
.btn-reject:hover {
  background: #c0392b;
}

.btn-hangup {
  background: #e74c3c;
  color: white;
}
.btn-hangup:hover {
  background: #c0392b;
}

.btn.active {
  background: #f39c12;
  color: white;
}

/* Call Info Layout */
.call-info {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 10px;
  text-align: left;
}

.call-details h3 {
  margin: 0;
  font-size: 1.1rem;
  color: #2c3e50;
}

.duration {
  margin: 5px 0 0;
  color: #2ecc71;
  font-weight: bold;
  font-size: 1rem;
}

.direction {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: #7f8c8d;
}
</style>