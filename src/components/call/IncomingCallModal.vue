<template>
  <transition name="call-pop">
    <div v-if="isOpen" class="incoming-call-overlay">
      <div class="incoming-call-card">
        <!-- 1. Thanh trạng thái trên cùng -->
        <div class="card-topbar">
          <div class="reg-status">
            <span class="reg-dot"></span>
            <span class="reg-text">Registered</span>
          </div>
          <div class="topbar-right">
            <span class="lock-icon" title="Cuộc gọi được mã hóa SRTP">🔒</span>
          </div>
        </div>

        <!-- 2. Tiêu đề INCOMING CALL -->
        <div class="call-type-banner">
          <h2>INCOMING CALL</h2>
        </div>

        <!-- 3. Thông tin người gọi đến -->
        <div class="caller-profile">
          <h1 class="caller-name">{{ callerName }}</h1>
          <p class="caller-sip">{{ callerSip }}</p>
          <span v-if="callerDept" class="caller-dept">{{ callerDept }}</span>
        </div>

        <!-- 4. Avatar vòng tròn lớn có hiệu ứng sóng xung quanh (Radar Pulse) -->
        <div class="avatar-wrapper">
          <div class="pulse-ring"></div>
          <div class="pulse-ring delay"></div>
          <div class="avatar-circle">
            <span class="avatar-initials">{{ initials }}</span>
          </div>
        </div>

        <!-- 5. Hai nút hành động (Từ chối & Chấp nhận) -->
        <div class="action-footer">
          <!-- Nút Từ chối (Bên trái, màu xám/đỏ có biểu tượng cúp máy) -->
          <button class="btn-call-action btn-reject" title="Từ chối cuộc gọi" @click="handleReject">
            <span class="btn-icon">📵</span>
            <span class="btn-label">TỪ CHỐI</span>
          </button>

          <!-- Nút Nghe máy (Bên phải, màu xanh lam/xanh lá có biểu tượng nhấc máy) -->
          <button class="btn-call-action btn-accept" title="Chấp nhận cuộc gọi" @click="handleAccept">
            <span class="btn-icon">📞</span>
            <span class="btn-label">NGHE MÁY</span>
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, watch } from 'vue'
import { audioService } from '@/services/audioService'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  callData: {
    type: Object,
    default: () => ({}),
  },
})

const emit = defineEmits(['accept', 'reject'])

// Lấy thông tin người gọi
const callerName = computed(() => {
  return props.callData?.name || props.callData?.remote_name || `Máy lẻ ${props.callData?.extension || '1007'}`
})

const callerSip = computed(() => {
  if (props.callData?.sipUri) return props.callData.sipUri
  const ext = props.callData?.extension || '1007'
  return `sip:${ext}@192.168.1.50`
})

const callerDept = computed(() => {
  return props.callData?.dept || 'Nội bộ SDV LAN'
})

const initials = computed(() => {
  const name = callerName.value
  if (!name) return '📞'
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
})

// Tự động bật/tắt chuông cuộc gọi khi modal mở hoặc đóng
watch(
  () => props.isOpen,
  (val) => {
    if (val) {
      audioService.startIncomingRingtone()
    } else {
      audioService.stopIncomingRingtone()
    }
  },
  { immediate: true },
)

const handleAccept = () => {
  audioService.stopIncomingRingtone()
  emit('accept', props.callData)
}

const handleReject = () => {
  audioService.stopIncomingRingtone()
  audioService.playCallEndedTone()
  emit('reject', props.callData)
}
</script>

<style scoped>
.incoming-call-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.incoming-call-card {
  width: 90%;
  max-width: 380px;
  background: #ffffff;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  animation: cardIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes cardIn {
  from {
    transform: scale(0.9) translateY(20px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

/* 1. Top bar */
.card-topbar {
  background-color: #0284c7;
  color: #ffffff;
  padding: 10px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.reg-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  font-weight: 600;
}

.reg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #22c55e;
  box-shadow: 0 0 6px #22c55e;
}

.lock-icon {
  font-size: 0.85rem;
  opacity: 0.85;
}

/* 2. Banner INCOMING CALL */
.call-type-banner {
  background-color: #f1f5f9;
  padding: 12px 16px;
  text-align: center;
  border-bottom: 1px solid #e2e8f0;
}

.call-type-banner h2 {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #475569;
  margin: 0;
}

/* 3. Thông tin người gọi */
.caller-profile {
  text-align: center;
  padding: 24px 20px 12px 20px;
}

.caller-name {
  font-size: 1.4rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 6px 0;
}

.caller-sip {
  font-family: monospace;
  font-size: 0.85rem;
  color: #0284c7;
  margin: 0 0 8px 0;
}

.caller-dept {
  display: inline-block;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  color: #64748b;
  font-weight: 500;
}

/* 4. Avatar lớn có hiệu ứng radar pulse */
.avatar-wrapper {
  position: relative;
  width: 140px;
  height: 140px;
  margin: 20px auto 30px auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-circle {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: linear-gradient(135deg, #334155, #1e293b);
  border: 4px solid #0284c7;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 2.2rem;
  font-weight: 800;
  z-index: 2;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
}

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid #0284c7;
  animation: pulseEffect 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  opacity: 0;
  z-index: 1;
}

.pulse-ring.delay {
  animation-delay: 1s;
}

@keyframes pulseEffect {
  0% {
    transform: scale(0.8);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.4);
    opacity: 0;
  }
}

/* 5. Hai nút hành động ở chân modal */
.action-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid #e2e8f0;
}

.btn-call-action {
  border: none;
  padding: 20px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s;
}

.btn-reject {
  background-color: #64748b;
  color: #ffffff;
  border-right: 1px solid rgba(255, 255, 255, 0.15);
}

.btn-reject:hover {
  background-color: #dc2626;
}

.btn-accept {
  background-color: #0284c7;
  color: #ffffff;
}

.btn-accept:hover {
  background-color: #059669;
}

.btn-icon {
  font-size: 1.8rem;
}

.btn-label {
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.5px;
}

/* Transition hiệu ứng bật/tắt */
.call-pop-enter-active,
.call-pop-leave-active {
  transition: opacity 0.3s ease;
}

.call-pop-enter-from,
.call-pop-leave-to {
  opacity: 0;
}
</style>

