<template>
  <div class="calls-view">
    <div class="view-header">
      <h1>Quay Số & Đàm Thoại WebRTC</h1>
      <span class="sub-text">Thực hiện cuộc gọi nội bộ qua giao thức SIP over WebSocket</span>
    </div>

    <div class="dialer-layout">
      <!-- Bàn phím số (Dialpad) -->
      <div class="dialer-box">
        <div class="dialer-screen">
          <input
            v-model="extension"
            type="tel"
            placeholder="Nhập số máy lẻ..."
            maxlength="6"
            @keyup.enter="handleDial"
          />
        </div>

        <div class="keypad-grid">
          <button
            v-for="k in keys"
            :key="k.num"
            class="key-btn"
            @click="pressKey(k.num)"
          >
            <span class="num">{{ k.num }}</span>
            <small v-if="k.sub">{{ k.sub }}</small>
          </button>
        </div>

        <div class="dial-actions">
          <button class="btn-dial" title="Bắt đầu gọi" @click="handleDial">
            📞
          </button>
          <button class="btn-clear" title="Xóa một số" @click="clearDigit">
            ⌫
          </button>
        </div>
      </div>

      <!-- Màn hình trạng thái cuộc gọi WebRTC -->
      <div class="call-status-box" :class="{ inCall: isCalling, onHold: isHeld }">
        <div class="call-avatar">
          <span>{{ callAvatarInitials }}</span>
        </div>

        <div class="caller-details">
          <h3>{{ callerName }}</h3>
          <p class="sip-uri">{{ callerSip }}</p>
          <p v-if="isCalling" class="duration-text">{{ formattedDuration }}</p>
          <p v-else class="idle-text">Sẵn sàng thực hiện cuộc gọi</p>
        </div>

        <!-- Điều khiển cuộc gọi -->
        <div class="controls-row">
          <button
            class="control-btn"
            :class="{ active: isMuted }"
            :disabled="!isCalling"
            title="Tắt tiếng Micro"
            @click="toggleMute"
          >
            {{ isMuted ? '🔇' : '🎙️' }}
          </button>

          <button
            class="control-btn"
            :class="{ active: isHeld }"
            :disabled="!isCalling"
            title="Giữ máy (Hold)"
            @click="toggleHold"
          >
            {{ isHeld ? '▶️' : '⏸️' }}
          </button>

          <button
            class="control-btn"
            :class="{ active: isSpeaker }"
            :disabled="!isCalling"
            title="Loa ngoài (Speaker)"
            @click="isSpeaker = !isSpeaker"
          >
            🔊
          </button>

          <button
            class="control-btn btn-hangup"
            :disabled="!isCalling"
            title="Cúp máy"
            @click="hangupCall"
          >
            📵
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { wazoService } from '@/services/wazo'
import { audioService } from '@/services/audioService'

const route = useRoute()
const extension = ref('1002')
const isCalling = ref(false)
const isMuted = ref(false)
const isHeld = ref(false)
const isSpeaker = ref(false)
const callSeconds = ref(0)
let timer = null

const keys = [
  { num: '1', sub: '' },
  { num: '2', sub: 'ABC' },
  { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' },
  { num: '5', sub: 'JKL' },
  { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' },
  { num: '8', sub: 'TUV' },
  { num: '9', sub: 'WXYZ' },
  { num: '*', sub: '' },
  { num: '0', sub: '+' },
  { num: '#', sub: '' },
]

const callerName = computed(() => {
  if (isCalling.value) {
    if (isHeld.value) return `Máy lẻ ${extension.value} (Tạm giữ - Hold)`
    return `Đang đàm thoại: Máy lẻ ${extension.value}`
  }
  return 'Sẵn sàng kết nối cuộc gọi'
})

const callerSip = computed(() => {
  if (isCalling.value) return `sip:${extension.value}@107.126.11.126`
  return 'WebRTC SIP Line 1001'
})

const callAvatarInitials = computed(() => {
  if (isCalling.value) return extension.value.slice(-2)
  return '📞'
})

const formattedDuration = computed(() => {
  const m = Math.floor(callSeconds.value / 60)
  const s = callSeconds.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const pressKey = (key) => {
  audioService.playDtmfTone(key)
  if (extension.value.length < 6) {
    extension.value += key
  }
}

const clearDigit = () => {
  extension.value = extension.value.slice(0, -1)
}

const handleDial = () => {
  const ext = extension.value.trim()
  if (!ext) return

  audioService.playRingbackTone()

  // Thử gọi qua wazoService hoặc chạy chế độ mô phỏng WebRTC
  try {
    wazoService.makeCall(ext)
  } catch (e) {
    console.log('Chế độ mô phỏng cuộc gọi:', e)
  }

  isCalling.value = true
  isHeld.value = false
  callSeconds.value = 0
  clearInterval(timer)
  timer = setInterval(() => {
    if (!isHeld.value) {
      callSeconds.value++
    }
  }, 1000)
}

const hangupCall = () => {
  audioService.playCallEndedTone()
  try {
    wazoService.hangup()
  } catch (e) {
    /* ignore */
  }
  isCalling.value = false
  isHeld.value = false
  clearInterval(timer)
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
}

const toggleHold = () => {
  isHeld.value = !isHeld.value
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: isHeld.value
          ? '⏸️ Đang giữ máy (Hold). Luồng âm thanh tạm dừng.'
          : '▶️ Đã tiếp tục đàm thoại (Resume).',
        type: 'info',
      },
    }),
  )
}

// Lắng nghe thay đổi query param từ danh bạ hoặc thanh tìm kiếm
watch(
  () => route.query,
  (newQuery) => {
    if (newQuery && newQuery.number) {
      extension.value = String(newQuery.number)
      if (newQuery.autocall === 'true') {
        setTimeout(() => {
          handleDial()
        }, 150)
      }
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.calls-view {
  max-width: 950px;
  margin: 0 auto;
}

.view-header {
  margin-bottom: 24px;
}

.view-header h1 {
  font-size: 1.5rem;
  color: #1e293b;
  margin: 0 0 6px 0;
}

.sub-text {
  color: #64748b;
  font-size: 0.88rem;
}

.dialer-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 24px;
  align-items: start;
}

/* Dialer Box */
.dialer-box {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  padding: 24px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.dialer-screen input {
  width: 100%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 2px;
  color: #1e293b;
  text-align: center;
  outline: none;
  margin-bottom: 20px;
}

.dialer-screen input:focus {
  border-color: #3b82f6;
  background: white;
}

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.key-btn {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  margin: 0 auto;
  font-size: 1.3rem;
  font-weight: 600;
  color: #1e293b;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.key-btn:hover {
  background: #e2e8f0;
  transform: scale(1.05);
}

.key-btn small {
  font-size: 0.55rem;
  color: #64748b;
  font-weight: normal;
  margin-top: -2px;
}

.dial-actions {
  display: flex;
  gap: 16px;
  justify-content: center;
  align-items: center;
}

.btn-dial {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #22c55e;
  color: white;
  font-size: 1.5rem;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
  transition: all 0.2s;
}

.btn-dial:hover {
  background: #16a34a;
  transform: scale(1.05);
}

.btn-clear {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #e2e8f0;
  color: #475569;
  font-size: 1.1rem;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Call Status Box */
.call-status-box {
  background: linear-gradient(135deg, #1e293b, #0f172a);
  color: white;
  border-radius: 12px;
  padding: 36px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.call-avatar {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  border: 4px solid #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.2rem;
  margin-bottom: 16px;
  background: #1e3a8a;
  color: white;
  font-weight: 700;
}

.caller-details h3 {
  font-size: 1.4rem;
  margin: 0 0 6px 0;
}

.sip-uri {
  font-size: 0.85rem;
  color: #94a3b8;
  font-family: monospace;
  margin: 0 0 10px 0;
}

.duration-text {
  font-size: 1.3rem;
  color: #4ade80;
  font-weight: 700;
  font-family: monospace;
  margin: 10px 0 24px 0;
}

.idle-text {
  font-size: 0.9rem;
  color: #64748b;
  margin: 10px 0 24px 0;
}

.controls-row {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.control-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: white;
  font-size: 1.2rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
}

.control-btn.active {
  background: #f59e0b;
}

.control-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.control-btn.btn-hangup {
  background: #ef4444;
  width: 56px;
  height: 56px;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.5);
}

.control-btn.btn-hangup:hover:not(:disabled) {
  background: #dc2626;
  transform: scale(1.05);
}

@media (max-width: 768px) {
  .dialer-layout {
    grid-template-columns: 1fr;
  }
}
</style>

