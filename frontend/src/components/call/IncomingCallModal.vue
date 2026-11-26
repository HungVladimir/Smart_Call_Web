<template>
  <transition name="call-pop">
    <div v-if="isOpen" class="incoming-call-overlay">
      <div class="incoming-call-card">
        <!-- 1. Header tinh tế dạng badge nổi -->
        <div class="card-header">
          <div class="incoming-badge">
            <UiIcon name="phone-outline" class="incoming-badge-icon" />
            <span>CUỘC GỌI ĐẾN</span>
          </div>
        </div>

        <!-- 2. Avatar vòng tròn lớn với hiệu ứng sóng Radar Pulse -->
        <div class="avatar-wrapper">
          <div class="pulse-ring"></div>
          <div class="pulse-ring delay"></div>
          <div class="avatar-circle" :style="{ backgroundColor: avatarBg }">
            <span class="avatar-initials">{{ initials }}</span>
          </div>
        </div>

        <!-- 3. Thông tin người gọi đến -->
        <div class="caller-profile">
          <h1 class="caller-name">{{ callerName }}</h1>
          <div class="caller-info-pill">
            <span class="pill-ext">Máy lẻ {{ callerExt }}</span>
            <span v-if="callerDept" class="pill-divider">•</span>
            <span v-if="callerDept" class="pill-dept">{{ callerDept }}</span>
          </div>
          <p class="caller-sip">{{ callerSip }}</p>
        </div>

        <!-- 4. Cặp nút tròn nổi chuẩn UX (Từ chối & Nghe máy) -->
        <div class="action-footer">
          <!-- Nút Từ chối -->
          <div class="action-btn-item">
            <button class="btn-circle btn-reject" title="Từ chối cuộc gọi" @click="handleReject">
              <UiIcon name="reject" class="action-svg" />
            </button>
            <span class="action-text text-reject">Từ chối</span>
          </div>

          <!-- Nút Nghe máy -->
          <div class="action-btn-item">
            <button class="btn-circle btn-accept" title="Nghe máy" @click="handleAccept">
              <div class="btn-pulse-wave"></div>
              <UiIcon name="phone-outline" class="action-svg" />
            </button>
            <span class="action-text text-accept">Nghe máy</span>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import UiIcon from '@/components/common/UiIcon.vue'
import { computed, watch } from 'vue'
import { callToneService } from '@/services/audio/audioService.js'
import { authService } from '@/services/index.js'
import { getAvatarInitials, getAvatarColor } from '@/utils/avatar.js'

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

const emit = defineEmits(['accept', 'reject', 'timeout'])

/** Trích tên hiển thị người gọi đến, fallback sang số máy lẻ khi thiếu tên. */
function resolveCallerName() {
  const ext = props.callData?.extension || props.callData?.number
  return (
    props.callData?.name ||
    props.callData?.remote_name ||
    (ext ? `Máy lẻ ${ext}` : 'Chưa xác định người gọi')
  )
}

/** Lấy tên người gọi đến phản ứng theo dữ liệu phiên gọi hiện tại. */
const callerName = computed(resolveCallerName)

/** Đọc máy lẻ thực tế của cuộc gọi đến; thiếu dữ liệu thì để trống thay vì tự điền số mẫu. */
const callerExt = computed(() => props.callData?.extension || props.callData?.number || '')

/** Dựng địa chỉ SIP URI từ dữ liệu SDK hoặc từ máy lẻ và host tổng đài thật. */
function resolveCallerSip() {
  if (props.callData?.sipUri) return props.callData.sipUri
  const ext = props.callData?.extension || props.callData?.number || ''
  const domain = (authService.host || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
  return ext && domain ? `sip:${ext}@${domain}` : ''
}

/** Hiển thị SIP URI được SDK cung cấp hoặc dựng từ máy lẻ/host thật khi cả hai đều có. */
const callerSip = computed(resolveCallerSip)

/** Đọc phòng ban của người gọi, dùng nhãn chung khi SDK/danh bạ chưa cung cấp. */
const callerDept = computed(() => props.callData?.dept || 'Nội bộ công ty')

/** Tính chữ viết tắt cho avatar của người gọi đến bằng helper dùng chung. */
const initials = computed(() => getAvatarInitials(callerName.value))

/** Tính màu avatar ổn định của người gọi đến từ tên hiển thị bằng helper dùng chung. */
const avatarBg = computed(() => getAvatarColor(callerName.value))

let ringTimer = null

/** Bật hoặc tắt chuông báo cuộc gọi đến và đặt hẹn giờ nhỡ 30 giây khi modal mở. */
function handleIncomingModalVisibility(isModalOpen) {
  clearTimeout(ringTimer)
  if (isModalOpen) {
    callToneService.startIncomingRingtone()
    // Tự động chuyển thành cuộc gọi nhỡ nếu đổ chuông quá 30 giây.
    ringTimer = setTimeout(handleTimeout, 30000)
  } else {
    callToneService.stopIncomingRingtone()
  }
}

watch(() => props.isOpen, handleIncomingModalVisibility, { immediate: true })

/** Phát yêu cầu nghe máy lên nơi sở hữu cuộc gọi; component không tự quyết định đã connected. */
const handleAccept = () => {
  clearTimeout(ringTimer)
  callToneService.stopIncomingRingtone()
  emit('accept', props.callData)
}

/** Phát yêu cầu từ chối lên App/service và kết thúc phần báo cuộc gọi đến của modal. */
const handleReject = () => {
  clearTimeout(ringTimer)
  callToneService.stopIncomingRingtone()
  callToneService.playCallEndedTone()
  emit('reject', props.callData)
}

/** Báo cuộc gọi đến hết thời gian chờ để App/service ghi nhận missed và dọn nhánh tương ứng. */
const handleTimeout = () => {
  callToneService.stopIncomingRingtone()
  callToneService.playCallEndedTone()
  emit('timeout', props.callData)
}
</script>

<style scoped>
.incoming-call-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.incoming-call-card {
  width: 90%;
  max-width: 360px;
  background: #ffffff;
  border-radius: 28px;
  padding: 28px 24px 32px 24px;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: cardIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
}

@keyframes cardIn {
  from {
    transform: scale(0.92) translateY(24px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

/* 1. Card Header */
.card-header {
  width: 100%;
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.incoming-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1d4ed8;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.8px;
  padding: 5px 14px;
  border-radius: 20px;
}

.incoming-badge-icon {
  width: 14px;
  height: 14px;
  animation: badgeShake 1.2s ease-in-out infinite;
}

@keyframes badgeShake {
  0%,
  100% {
    transform: rotate(0deg);
  }
  20% {
    transform: rotate(-15deg);
  }
  40% {
    transform: rotate(15deg);
  }
  60% {
    transform: rotate(-10deg);
  }
  80% {
    transform: rotate(10deg);
  }
}

/* 2. Avatar Wrapper với Radar Pulse */
.avatar-wrapper {
  position: relative;
  width: 120px;
  height: 120px;
  margin: 0 auto 18px auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-circle {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  border: 3px solid #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: 1px;
  z-index: 2;
  box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.4);
}

.pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid #3b82f6;
  animation: pulseEffect 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  opacity: 0;
  z-index: 1;
}

.pulse-ring.delay {
  animation-delay: 1s;
}

@keyframes pulseEffect {
  0% {
    transform: scale(0.75);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}

/* 3. Thông tin người gọi */
.caller-profile {
  text-align: center;
  width: 100%;
  margin-bottom: 28px;
}

.caller-name {
  font-size: 1.35rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 8px 0;
  line-height: 1.3;
}

.caller-info-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f1f5f9;
  padding: 4px 12px;
  border-radius: 14px;
  font-size: 0.8rem;
  color: #475569;
  font-weight: 600;
  margin-bottom: 6px;
}

.pill-divider {
  color: #94a3b8;
}

.caller-sip {
  font-family: monospace;
  font-size: 0.78rem;
  color: #94a3b8;
  margin: 0;
}

/* 4. Chân Card: Cặp nút tròn nổi */
.action-footer {
  width: 100%;
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0 10px;
}

.action-btn-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.btn-circle {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.2);
}

.btn-circle:hover {
  transform: scale(1.08);
}

.btn-circle:active {
  transform: scale(0.96);
}

.btn-reject {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #ffffff;
  box-shadow: 0 8px 20px -4px rgba(239, 68, 68, 0.45);
}

.btn-reject:hover {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 10px 24px -4px rgba(220, 38, 38, 0.6);
}

.btn-accept {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #ffffff;
  box-shadow: 0 8px 20px -4px rgba(16, 185, 129, 0.45);
}

.btn-accept:hover {
  background: linear-gradient(135deg, #059669, #047857);
  box-shadow: 0 10px 24px -4px rgba(5, 150, 105, 0.6);
}

.btn-pulse-wave {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid #10b981;
  animation: answerPulse 1.6s ease-out infinite;
  pointer-events: none;
}

@keyframes answerPulse {
  0% {
    transform: scale(0.9);
    opacity: 0.9;
  }
  100% {
    transform: scale(1.3);
    opacity: 0;
  }
}

.action-svg {
  width: 26px;
  height: 26px;
  z-index: 2;
}

.action-text {
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.text-reject {
  color: #ef4444;
}

.text-accept {
  color: #059669;
}

/* Transition Modal */
.call-pop-enter-active,
.call-pop-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.call-pop-enter-from,
.call-pop-leave-to {
  opacity: 0;
}
</style>
