<template>
  <div class="calls-view">
    <div class="view-header">
      <h1>Bàn phím & Gọi thoại</h1>
      <span class="sub-text">Nhập số máy lẻ nội bộ để kết nối cuộc gọi trực tiếp</span>
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

        <!-- 2 nút thao tác đặt ngay giữa tâm, đối xứng qua phím số 0 -->
        <div class="dial-actions">
          <button
            class="btn-dial"
            title="Bắt đầu gọi"
            @click="handleDial"
            :disabled="isCalling"
          >
            <svg class="dial-svg-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z" />
            </svg>
          </button>
          <button
            class="btn-clear"
            :class="{ visible: Boolean(extension) }"
            title="Xóa một số"
            @click="clearDigit"
            :disabled="!extension"
          >
            <svg class="clear-svg-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.5-7.5H21a1 1 0 011 1v13a1 1 0 01-1 1H9.5L3 12z" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Màn hình trạng thái cuộc gọi -->
      <div class="call-status-box" :class="{ inCall: isCalling, onHold: isHeld }">
        <div class="call-avatar" :class="{ pulsing: isCalling }">
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
          <!-- Nút Tắt/Bật Micro (Mute) -->
          <button
            class="control-btn"
            :class="{ active: isMuted, muted: isMuted }"
            :disabled="!isCalling"
            :title="isMuted ? 'Bật lại Micro' : 'Tắt Micro (Mute)'"
            @click="toggleMute"
          >
            <svg v-if="!isMuted" class="ctrl-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-15a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3z" />
            </svg>
            <svg v-else class="ctrl-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="1" y1="1" x2="23" y2="23" stroke-linecap="round" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M17 16.95A7 7 0 015 11m12 0a6.97 6.97 0 01-.64 2.92M12 19v4m-4 0h8" />
            </svg>
          </button>

          <!-- Nút Giữ máy (Hold) -->
          <button
            class="control-btn"
            :class="{ active: isHeld }"
            :disabled="!isCalling"
            :title="isHeld ? 'Tiếp tục cuộc gọi' : 'Giữ cuộc gọi (Hold)'"
            @click="toggleHold"
          >
            <svg v-if="!isHeld" class="ctrl-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
            <svg v-else class="ctrl-svg-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          <!-- Nút Loa ngoài (Speaker) -->
          <button
            class="control-btn"
            :class="{ active: isSpeaker }"
            :disabled="!isCalling"
            :title="isSpeaker ? 'Tắt loa ngoài' : 'Bật loa ngoài'"
            @click="isSpeaker = !isSpeaker"
          >
            <svg class="ctrl-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          </button>

          <!-- Nút Cúp máy (Hangup) -->
          <button
            class="control-btn btn-hangup"
            :disabled="!isCalling"
            title="Ngắt kết nối / Cúp máy"
            @click="hangupCall"
          >
            <svg class="ctrl-svg-icon hangup-svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.28 8.82 7.42 7 12 7s8.72 1.82 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
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

const handleDial = async () => {
  const ext = extension.value.trim()
  if (!ext) return

  audioService.playRingbackTone()

  isCalling.value = true
  isHeld.value = false
  callSeconds.value = 0
  clearInterval(timer)

  // Gọi thật qua Wazo WebRTC
  try {
    const session = await wazoService.makeCall(ext)
    if (session) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `📞 Đang thiết lập cuộc gọi WebRTC tới máy lẻ ${ext}...`,
            type: 'info',
          },
        }),
      )
    }
  } catch (e) {
    console.log('Chưa kết nối được máy lẻ thật qua WebRTC (Chế độ mô phỏng):', e)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `📞 Đang kết nối tín hiệu cuộc gọi thoại tới máy lẻ ${ext}...`,
          type: 'info',
        },
      }),
    )
  }

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
  try {
    wazoService.mute()
  } catch (e) {
    /* ignore */
  }
}

const toggleHold = () => {
  isHeld.value = !isHeld.value
  try {
    wazoService.hold()
  } catch (e) {
    /* ignore */
  }
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

// Xử lý các sự kiện cuộc gọi thật từ máy chủ Wazo
const onRemoteAccepted = () => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `🎉 Cuộc gọi đã được kết nối thành công! Đang đàm thoại...`, type: 'success' },
    }),
  )
}

const onRemoteEnded = () => {
  hangupCall()
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `Cuộc gọi đã kết thúc.`, type: 'info' },
    }),
  )
}

const onRemoteFailed = () => {
  hangupCall()
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `Cuộc gọi không thành công (Máy bận hoặc đối phương chưa đăng nhập).`, type: 'warning' },
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
      } else if (newQuery.active === 'true') {
        // Cuộc gọi đến vừa được nghe máy -> Đang đàm thoại trực tiếp
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
    }
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('wazo-accepted', onRemoteAccepted)
  window.addEventListener('wazo-ended', onRemoteEnded)
  window.addEventListener('wazo-failed', onRemoteFailed)
})

onUnmounted(() => {
  window.removeEventListener('wazo-accepted', onRemoteAccepted)
  window.removeEventListener('wazo-ended', onRemoteEnded)
  window.removeEventListener('wazo-failed', onRemoteFailed)
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
  gap: 20px;
  justify-content: center;
  align-items: center;
  margin-top: 10px;
}

.btn-dial {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-dial:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: scale(1.05);
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.45);
}

.btn-dial:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.dial-svg-icon {
  width: 22px;
  height: 22px;
  fill: #ffffff;
  flex-shrink: 0;
}

.btn-clear {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  border: 1.5px solid #cbd5e1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0.35;
}

.btn-clear.visible {
  opacity: 1;
}

.btn-clear:hover:not(:disabled) {
  background: #fee2e2;
  color: #ef4444;
  border-color: #fca5a5;
  transform: scale(1.05);
}

.btn-clear:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.clear-svg-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

/* Call Status Box */
.call-status-box {
  background: linear-gradient(145deg, #1e293b, #0f172a);
  color: white;
  border-radius: 16px;
  padding: 36px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 420px;
  border: 1px solid #334155;
  box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.2), 0 8px 10px -6px rgba(15, 23, 42, 0.2);
  position: relative;
  overflow: hidden;
}

.call-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  border: 3px solid #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin-bottom: 16px;
  background: linear-gradient(135deg, #1e3a8a, #2563eb);
  color: white;
  font-weight: 700;
  position: relative;
  transition: all 0.3s;
}

.call-avatar.pulsing {
  border-color: #10b981;
  box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.25);
  animation: pulse-ring 2s infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(16, 185, 129, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
  }
}

.caller-details h3 {
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0 0 6px 0;
  color: #f8fafc;
}

.sip-uri {
  font-size: 0.85rem;
  color: #94a3b8;
  font-family: monospace;
  margin: 0 0 10px 0;
}

.duration-text {
  font-size: 1.4rem;
  color: #34d399;
  font-weight: 700;
  font-family: monospace;
  margin: 10px 0 24px 0;
  letter-spacing: 1px;
}

.idle-text {
  font-size: 0.88rem;
  color: #64748b;
  margin: 10px 0 24px 0;
}

.controls-row {
  display: flex;
  gap: 16px;
  margin-top: 10px;
}

.control-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.ctrl-svg-icon {
  width: 22px;
  height: 22px;
  stroke: #ffffff;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.control-btn.active {
  background: #f59e0b;
  border-color: #d97706;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.45);
}

.control-btn.muted {
  background: #ef4444;
  border-color: #dc2626;
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.45);
}

.control-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.control-btn.btn-hangup {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-color: #b91c1c;
  width: 56px;
  height: 56px;
  box-shadow: 0 6px 18px rgba(239, 68, 68, 0.45);
}

.control-btn.btn-hangup:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  transform: scale(1.06);
  box-shadow: 0 8px 22px rgba(239, 68, 68, 0.6);
}

.hangup-svg {
  fill: #ffffff;
  width: 24px;
  height: 24px;
}

@media (max-width: 768px) {
  .dialer-layout {
    grid-template-columns: 1fr;
  }
}
</style>

