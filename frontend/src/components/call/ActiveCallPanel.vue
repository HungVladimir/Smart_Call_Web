<template>
  <section class="status-col" :class="{ 'is-active-call': isCalling, 'is-idle': !isCalling }">
    <div class="call-status-box inCall" :class="{ isRinging: callStatus === 'ringing' }">
      <!-- Giao diện Đầy đủ khi Đang Gọi -->
      <div class="status-full-content">
        <!-- 1. Trạng thái Đang Gọi (Active Call / Ringing / Talking) -->
        <div
          class="call-avatar pulsing"
          :class="{
            ringingPulse: callStatus === 'ringing',
            groupCallAvatar: isGroupCall,
          }"
          :style="{ backgroundColor: activeCallAvatarBg }"
        >
          <EmployeeAvatar
            :user-uuid="activeCallContact?.uuid || ''"
            :enabled="!isGroupCall && Boolean(activeCallContact?.hasEmployeeAvatar)"
            :fallback="activeCallAvatarText"
          />
        </div>

        <div class="caller-details">
          <div v-if="isGroupCall" class="group-call-badge-tag">👥 Cuộc gọi nhóm Ad-hoc</div>
          <h2 class="caller-title">{{ activeCallTitle }}</h2>
          <div v-if="activeCallDept" class="caller-dept-badge">{{ activeCallDept }}</div>
          <p class="duration-text" :class="{ ringingText: callStatus === 'ringing' }">
            {{ durationText }}
          </p>
          <div v-if="isGroupCall && groupMembersSummary" class="group-members-summary-text">
            Thành viên: {{ groupMembersSummary }}
          </div>
          <div
            v-if="isGroupCall && pendingRingingMembers.length > 0"
            class="group-pending-summary-text"
          >
            <span class="connecting-pulse-dot">⏳</span> Đang kết nối
            {{ pendingRingingMembers.join(', ') }}...
          </div>
          <p v-if="dtmfLog" class="dtmf-display">Phím số: {{ dtmfLog }}</p>
          <div v-if="isRecording" class="recording-indicator-tag">
            <span class="rec-pulse-dot">●</span> {{ formattedRecordingDuration }} Đang ghi âm
          </div>
        </div>

        <!-- Hàng nút điều khiển cuộc gọi (chỉ hiển thị khi đang có cuộc gọi hoạt động) -->
        <div class="controls-row">
          <!-- Nút Tắt/Bật Micro (Mute) -->
          <button
            class="control-btn"
            :class="{ active: isMuted, muted: isMuted }"
            :disabled="!isCalling"
            :title="isMuted ? 'Bật lại Micro' : 'Tắt Micro (Mute)'"
            @click="$emit('mute')"
          >
            <svg
              v-if="!isMuted"
              class="ctrl-svg-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8"
              />
            </svg>
            <svg
              v-else
              class="ctrl-svg-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="1" y1="1" x2="23" y2="23" stroke-linecap="round" />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"
              />
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M17 16.95A7 7 0 015 11m12 0a6.97 6.97 0 01-.64 2.92M12 19v4m-4 0h8"
              />
            </svg>
          </button>

          <!-- Nút Thêm người vào cuộc gọi (Add Member) -->
          <button
            class="control-btn btn-add-member"
            :disabled="!isCalling || callStatus === 'ringing'"
            title="Mời thêm thành viên vào cuộc gọi"
            @click="$emit('add-participant')"
          >
            <svg
              class="ctrl-svg-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </button>

          <!-- Nút Ghi âm (Record trên tổng đài) -->
          <button
            class="control-btn btn-record"
            :class="{ active: isRecording, recording: isRecording }"
            :disabled="!isCalling || callStatus === 'ringing'"
            :title="
              isRecording
                ? 'Dừng ghi âm cuộc gọi trên tổng đài (bấm vào để dừng ghi âm)'
                : callStatus === 'ringing'
                  ? 'Chờ đối phương nhấc máy để bắt đầu ghi âm'
                  : 'Bắt đầu ghi âm cuộc gọi trên tổng đài'
            "
            @click="$emit('record')"
          >
            <span v-if="isRecording" class="rec-dot-pulse">●</span>
            <span v-if="isRecording" class="rec-label"
              >{{ formattedRecordingDuration }} Đang ghi âm</span
            >
            <svg
              v-else
              class="ctrl-svg-icon rec-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="5" fill="#ef4444" stroke="#ef4444" />
              <circle cx="12" cy="12" r="9" stroke="#ef4444" stroke-width="2" />
            </svg>
          </button>

          <!-- Nút Cúp máy (Hangup) -->
          <button
            class="control-btn btn-hangup"
            :disabled="!isCalling"
            title="Ngắt kết nối / Cúp máy"
            @click="$emit('hangup')"
          >
            <svg class="ctrl-svg-icon hangup-svg" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.28 8.82 7.42 7 12 7s8.72 1.82 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import EmployeeAvatar from '@/components/EmployeeAvatar.vue'
import { computed } from 'vue'
import { getAvatarInitials as getInitials, getAvatarColor } from '@/utils/avatar.js'

/** Khung trình bày cuộc gọi; chỉ phát lệnh lên view, không gọi SDK/API. */
const props = defineProps({
  call: { type: Object, default: null },
  group: { type: Object, required: true },
  contacts: { type: Array, required: true },
  recording: { type: Object, required: true },
  myExtension: { type: String, default: '' },
  durationText: { type: String, default: '00:00' },
  dtmfLog: { type: String, default: '' },
})
defineEmits(['mute', 'record', 'hangup', 'add-participant'])
/**
 * Đọc danh bạ hiện tại theo cơ chế phản ứng của Vue, không tạo bản sao dữ liệu riêng cho giao
 * diện.
 */
const contacts = computed(() => props.contacts)
/** Cho biết có cuộc gọi đang được quản lý để bật/tắt vùng đàm thoại và chặn thao tác gọi chồng. */
const isCalling = computed(() => Boolean(props.call))
/**
 * Lấy trạng thái hiện tại của cuộc gọi; dùng idle khi chưa có cuộc gọi để giao diện hiển thị đúng
 * nhánh.
 */
const callStatus = computed(() => props.call?.status || 'idle')
/** Đọc trạng thái tắt microphone của cuộc gọi để đồng bộ biểu tượng và nút điều khiển. */
const isMuted = computed(() => Boolean(props.call?.isMuted))
/** Cho biết ghi âm trên tổng đài đang hoạt động; không đồng nghĩa đang phát lại một file audio. */
const isRecording = computed(() => props.recording.isRecording)
/** Tìm liên hệ theo máy lẻ trong dữ liệu được truyền vào component, không phát sinh request API. */
const findContact = (ext) =>
  props.contacts.find((contact) => String(contact.number || '').trim() === String(ext || '').trim())
/** Định dạng thời gian ghi âm thành phút:giây để đồng bộ chỉ báo và nút ghi âm. */
const formattedRecordingDuration = computed(() => {
  const s = props.recording.duration || 0
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
})

/** Tìm thông tin danh bạ của số đang gọi để bổ sung tên, phòng ban và avatar cho UI. */
const activeCallContact = computed(() => {
  const num = props.call?.number || ''
  if (!num) return null
  return (
    contacts.value.find((c) => String(c.number || '').trim() === String(num).trim()) ||
    findContact(num) ||
    null
  )
})

/** Xác định cuộc gọi hiện tại là gọi nhóm từ state cuộc gọi và state hội nghị. */
const isGroupCall = computed(() => Boolean(props.call?.isGroupCall || props.group.isGroupCall))

/** Ghép tên/máy lẻ thành viên thành mô tả nhóm, đánh dấu người dùng hiện tại là Bạn. */
const groupMembersSummary = computed(() => {
  const exts = props.call?.groupConnectedExtensions || props.group.groupConnectedExtensions || []
  if (!exts || exts.length === 0) return ''
  const myExt = props.myExtension || ''
  const names = exts.map((ext) => {
    if (ext === myExt) return 'Bạn'
    const c =
      contacts.value.find((ct) => String(ct.number || '').trim() === String(ext).trim()) ||
      findContact(ext)
    return c?.name ? `${c.name} (${ext})` : `Máy lẻ ${ext}`
  })
  return names.join(', ')
})

/** Liệt kê các nhánh phụ chưa nghe máy; bỏ nhánh answered để không báo đang kết nối sai. */
const pendingRingingMembers = computed(() => {
  const list = []
  const pending = props.call?.groupPendingExtensions || props.group.groupPendingExtensions || []
  for (const secExt of pending) {
    const contact = findContact(secExt)
    list.push(contact?.name ? contact.name + ' (' + secExt + ')' : 'Máy lẻ ' + secExt)
  }
  return list
})

/** Chọn tiêu đề cho cuộc gọi một người hoặc gọi nhóm, có xét trạng thái đang đổ chuông. */
const activeCallTitle = computed(() => {
  if (!props.call) return ''
  if (isGroupCall.value) {
    const count = (
      props.call.groupConnectedExtensions ||
      props.group.groupConnectedExtensions ||
      []
    ).length
    return `Cuộc gọi nhóm (${count} người)`
  }
  const ext = props.call.number || props.call?.number || ''
  if (props.call.status === 'ringing') {
    return `Đang đổ chuông: ${props.call.name || activeCallContact.value?.name || `Máy lẻ ${ext}`}`
  }
  return props.call.name || activeCallContact.value?.name || `Máy lẻ ${ext}`
})

/** Ưu tiên phòng ban của cuộc gọi; dùng danh bạ làm nguồn bổ sung khi dữ liệu cuộc gọi chưa có. */
const activeCallDept = computed(() => {
  return props.call?.dept || activeCallContact.value?.dept || ''
})

/** Chọn ký hiệu nhóm hoặc chữ viết tắt của người đang gọi cho avatar. */
const activeCallAvatarText = computed(() => {
  if (isGroupCall.value) return '👥'
  const name = props.call?.name || activeCallContact.value?.name
  if (name) return getInitials(name)
  if (props.call?.number) return props.call.number.slice(-2)
  return '📞'
})

/** Chọn màu avatar theo nhóm/tên để nhận diện người đang gọi một cách ổn định. */
const activeCallAvatarBg = computed(() => {
  if (isGroupCall.value) return '#059669'
  const name = props.call?.name || activeCallContact.value?.name
  if (name) return getAvatarColor(name)
  return '#2563eb'
})
</script>

<style>
/* CSS chỉ áp dụng trong .calls-view để giữ nguyên layout khi tách component. */
.calls-view .seg-btn.active {
  background: white;
  color: #1e88e5;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.calls-view .btn-mini-control.active {
  background: #ef4444;
}
.calls-view .status-col {
  width: 0;
  min-width: 0;
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  margin-right: 0;
  transform: scale(0.96);
  visibility: hidden;
  flex-shrink: 0;
  transition:
    width 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    max-width 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    min-width 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    margin-right 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.35s ease,
    transform 0.45s cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0.45s ease;
}

.calls-view .status-col.is-active-call {
  width: 400px;
  min-width: 380px;
  max-width: 420px;
  opacity: 1;
  overflow: visible;
  pointer-events: auto;
  margin-right: 20px;
  transform: scale(1);
  visibility: visible;
}

.calls-view .status-col .call-status-box {
  width: 400px;
  max-width: 400px;
  min-width: 360px;
  height: 580px;
  max-height: 580px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.calls-view .call-status-box {
  background: linear-gradient(145deg, #1e293b, #0f172a);
  color: white;
  border-radius: 14px;
  padding: 32px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 440px;
  border: 1px solid #334155;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.calls-view .call-avatar {
  width: 86px;
  height: 86px;
  border-radius: 50%;
  border: 3px solid #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  margin: 0 auto 16px auto;
  background: linear-gradient(135deg, #1e3a8a, #2563eb);
  color: white;
  font-weight: 700;
  position: relative;
  transition: all 0.3s;
}

.calls-view .call-avatar.pulsing {
  border-color: #10b981;
  box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.25);
  animation: calls-view-pulse-ring 2s infinite;
}

.calls-view .call-avatar.ringingPulse {
  border-color: #f59e0b;
  box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.25);
  animation: calls-view-calls-view-pulse-ring-amber 1.5s infinite;
}

.calls-view .caller-title {
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0 0 6px 0;
  color: #f8fafc;
  letter-spacing: -0.2px;
}

.calls-view .caller-dept-badge {
  display: inline-block;
  padding: 3px 10px;
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 12px;
}

.calls-view .status-dot-inline.ringing {
  background: #3b82f6;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.7);
}

.calls-view .call-avatar.idle-avatar {
  background: rgba(30, 41, 59, 0.8);
  border-color: #475569;
  font-size: 2.2rem;
}

.calls-view .duration-text {
  font-size: 1.45rem;
  color: #34d399;
  font-weight: 700;
  font-family: monospace;
  margin: 8px 0 20px 0;
  letter-spacing: 1px;
}

.calls-view .duration-text.ringingText {
  color: #fbbf24;
  font-size: 1.05rem;
  letter-spacing: 0.5px;
  animation: calls-view-calls-view-pulse-ring-amber 1.5s infinite;
}

.calls-view .controls-row {
  display: flex;
  gap: 10px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 6px;
}

.calls-view .control-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.calls-view .ctrl-svg-icon {
  width: 22px;
  height: 22px;
  stroke: #ffffff;
}

.calls-view .control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.calls-view .control-btn.active {
  background: #f59e0b;
  border-color: #d97706;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.45);
}

.calls-view .control-btn.muted {
  background: #ef4444;
  border-color: #dc2626;
  box-shadow: 0 0 14px rgba(239, 68, 68, 0.45);
}

.calls-view .control-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none;
}

.calls-view .control-btn.btn-hangup {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  border-color: #b91c1c;
  width: 54px;
  height: 54px;
  box-shadow: 0 6px 16px rgba(239, 68, 68, 0.45);
}

.calls-view .control-btn.btn-hangup:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  transform: scale(1.06);
}

.calls-view .control-btn.btn-record {
  border-color: rgba(239, 68, 68, 0.45);
}

.calls-view .control-btn.btn-record:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
}

.calls-view .control-btn.btn-record.recording {
  background: #dc2626;
  border-color: #b91c1c;
  width: auto;
  min-width: 50px;
  padding: 0 12px;
  border-radius: 25px;
  gap: 5px;
  animation: calls-view-pulse-rec-btn 1.4s infinite;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
}

.calls-view .rec-dot-pulse {
  color: #ffffff;
  font-size: 0.95rem;
  line-height: 1;
  animation: calls-view-blink-rec-dot 1s infinite;
}

.calls-view .rec-label {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  white-space: nowrap;
  color: #ffffff;
}

.calls-view .recording-indicator-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 12px;
  color: #fca5a5;
  font-size: 0.78rem;
  font-weight: 600;
  margin-top: 6px;
  animation: calls-view-pulse-rec-border 1.5s infinite;
}

.calls-view .rec-pulse-dot {
  color: #ef4444;
  font-size: 0.85rem;
  line-height: 1;
  animation: calls-view-blink-rec-dot 1s infinite;
}

.calls-view .hangup-svg {
  fill: #ffffff;
  width: 24px;
  height: 24px;
}

.calls-view .panel-tab-btn.active {
  color: #1e88e5;
  border-color: #93c5fd;
  background: #eff6ff;
  font-weight: 700;
}

.calls-view .panel-tab-btn.active .tab-badge {
  background: #2563eb;
  color: #ffffff;
}
.calls-view .panel-tab-btn.active .tab-badge.badge-online {
  background: #16a34a;
  color: #ffffff;
}
.calls-view .panel-tab-btn.active .tab-badge.badge-dept,
.calls-view .panel-tab-btn.active .tab-badge.badge-group {
  background: #2563eb;
  color: #ffffff;
}

.calls-view .dept-chip-btn.active {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #3b82f6;
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.15);
}

.calls-view .btn-star.active {
  color: #f59e0b;
}
@media (max-width: 1199px) and (min-width: 768px) {
  .calls-view .status-col.is-active-call {
    width: 340px;
    margin-right: 0;
  }

  .calls-view .status-col.is-active-call .call-status-box {
    width: 340px;
    max-width: 340px;
    min-width: 300px;
  }
  .calls-view .status-col.is-active-call .call-status-box {
    min-height: 280px;
    padding: 24px 16px;
  }

  .calls-view .status-col.is-active-call .call-avatar {
    width: 68px;
    height: 68px;
    font-size: 1.5rem;
    margin-bottom: 10px;
  }

  .calls-view .status-col.is-active-call .duration-text {
    margin: 6px 0 12px 0;
  }
}
@media (max-width: 768px) {
  .calls-view .calls-grid-layout.mobile-show-dialer .status-col {
    display: none;
  }

  .calls-view .calls-grid-layout.mobile-show-dialer .status-col.is-active-call {
    display: block;
    width: 100%;
    max-width: 100%;
    margin-right: 0;
    margin-bottom: 16px;
  }

  .calls-view .calls-grid-layout.mobile-show-dialer .status-col.is-active-call .call-status-box {
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  .calls-view .calls-grid-layout.mobile-show-contacts .status-col {
    display: none;
  }

  .calls-view .call-status-box {
    min-height: 280px;
    padding: 24px 16px;
  }

  .calls-view .call-avatar {
    width: 68px;
    height: 68px;
    font-size: 1.6rem;
  }
}
.calls-view .panel-tab-btn.tab-group-call.active {
  background: #ffffff;
  border-bottom-color: #2563eb;
  color: #2563eb;
}

.calls-view .custom-check-box.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f1f5f9;
}

.calls-view .badge-status-pill.ringing {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.calls-view .group-call-badge-tag {
  display: inline-block;
  padding: 3px 10px;
  background: #eff6ff;
  color: #1d4ed8;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 700;
  margin-bottom: 6px;
}

.calls-view .group-members-summary-text {
  font-size: 0.82rem;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.35;
  max-width: 320px;
  text-align: center;
}

.calls-view .group-pending-summary-text {
  font-size: 0.8rem;
  color: #d97706;
  font-weight: 600;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  animation: calls-view-pulseOpacity 1.5s infinite;
}

.calls-view .call-avatar.groupCallAvatar {
  background: #059669 !important;
}

.calls-view .tab-config-item.disabled {
  cursor: default;
  background: #f8fafc;
  opacity: 0.85;
}

.calls-view .control-btn.btn-add-member {
  color: white;
}
/* Giữ nền hover trong suốt như các nút điều khiển trên nền cuộc gọi tối. */
.calls-view .control-btn.btn-add-member:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}
</style>
