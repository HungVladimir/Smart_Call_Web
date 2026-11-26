<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card modal-card-lg">
      <div class="modal-head">
        <div class="head-title">
          <span><UiIcon name="settings" /> CÀI ĐẶT HỆ THỐNG (SETTINGS)</span>
          <small>• SmartCall Web v2.0</small>
        </div>
        <button class="btn-close" aria-label="Đóng cài đặt" @click="$emit('close')">
          <UiIcon name="close-heavy" />
        </button>
      </div>

      <!-- Settings Navigation Tabs -->
      <div class="settings-nav-tabs">
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'audio' }"
          @click="activeTab = 'audio'"
        >
          <UiIcon name="microphone-text" /> Âm thanh & WebRTC
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'calls' }"
          @click="activeTab = 'calls'"
        >
          <UiIcon name="phone-text" /> Dịch vụ cuộc gọi (PBX)
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'account' }"
          @click="activeTab = 'account'"
        >
          <UiIcon name="lock-text" /> Tài khoản & Mật khẩu
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'features' }"
          @click="activeTab = 'features'"
        >
          <UiIcon name="flag" /> Phân hệ tính năng
        </button>
      </div>

      <!-- Tab 1: Âm thanh & WebRTC (Thiết bị thật từ máy tính) -->
      <div v-show="activeTab === 'audio'" class="st-panel">
        <div class="st-field-group">
          <label class="st-label">Microphone thu âm (Audio Input - Thiết bị thật):</label>
          <select v-model="selectedMic" class="st-select" @change="restartMicMeter">
            <option v-for="mic in availableMics" :key="mic.deviceId" :value="mic.deviceId">
              {{ mic.label }}
            </option>
            <option v-if="availableMics.length === 0" value="default">
              Microphone Mặc định của hệ thống
            </option>
          </select>

          <div class="mic-meter-box">
            <span class="meter-text">Tín hiệu Micro (VU Meter thật):</span>
            <div class="mic-meter-bar">
              <div class="mic-meter-fill" :style="{ width: `${micLevel}%` }"></div>
            </div>
            <span class="meter-status" :class="{ active: isVoiceActive }"
              ><UiIcon :name="isVoiceActive ? 'status-available' : 'status-idle'" />
              {{ micStatusText }}</span
            >
          </div>
        </div>

        <div class="st-field-group">
          <label class="st-label">Loa / Tai nghe phát tiếng (Audio Output - Thiết bị thật):</label>
          <div class="output-row">
            <select v-model="selectedSpeaker" class="st-select">
              <option v-for="spk in availableSpeakers" :key="spk.deviceId" :value="spk.deviceId">
                {{ spk.label }}
              </option>
              <option v-if="availableSpeakers.length === 0" value="default">
                Loa / Tai nghe Mặc định của hệ thống
              </option>
            </select>
            <button class="btn-test-sound" @click="testSound">
              <UiIcon name="speaker" /> Thử loa
            </button>
          </div>
        </div>

        <div class="st-field-group">
          <label class="st-label"
            >Âm lượng chuông gọi đến (Ringtone Volume): {{ ringtoneVol }}%</label
          >
          <input v-model="ringtoneVol" disabled type="range" min="0" max="100" class="vol-slider" />
        </div>
      </div>

      <!-- Tab 2: Dịch vụ cuộc gọi tổng đài -->
      <div v-show="activeTab === 'calls'" class="st-panel">
        <div class="st-toggle-row">
          <div class="st-toggle-info">
            <strong>Không làm phiền (Do Not Disturb - DND)</strong>
            <small
              >Tự động từ chối và chặn đổ chuông tất cả cuộc gọi đến khi bạn đang họp hoặc bận
              việc.</small
            >
          </div>
          <input v-model="dndEnabled" type="checkbox" class="toggle-cb" />
        </div>

        <div class="st-toggle-row">
          <div class="st-toggle-info">
            <strong>Tự động ghi âm cuộc gọi trên tổng đài (Auto Record Calls)</strong>
            <small
              >Tự động kích hoạt ghi âm cuộc gọi trên máy chủ tổng đài ngay khi cuộc gọi thoại được
              kết nối.</small
            >
          </div>
          <input
            v-model="autoRecordCalls"
            type="checkbox"
            class="toggle-cb"
            @change="saveAutoRecord"
          />
        </div>

        <div class="forwards-section">
          <strong>Chuyển tiếp cuộc gọi (Call Forwarding):</strong>

          <div class="st-field-group">
            <label class="st-label">Chuyển tiếp khi Bận (Forward when Busy):</label>
            <input
              v-model="forwardBusy"
              type="text"
              class="st-input"
              placeholder="Nhập số máy lẻ chuyển tiếp (VD: 1002)..."
            />
          </div>

          <div class="st-field-group">
            <label class="st-label"
              >Chuyển tiếp khi Không trả lời sau 20s (Forward on No Answer):</label
            >
            <input
              v-model="forwardNoAnswer"
              type="text"
              class="st-input"
              placeholder="Nhập số máy lẻ (VD: 1003)..."
            />
          </div>

          <div class="st-field-group">
            <label class="st-label">Chuyển tiếp vô điều kiện (Unconditional Forwarding):</label>
            <input
              v-model="forwardAll"
              type="text"
              class="st-input"
              placeholder="Để trống nếu không muốn chuyển tiếp toàn bộ..."
            />
          </div>
        </div>
      </div>

      <!-- Tab 3: Tài khoản & Mật khẩu -->
      <div v-show="activeTab === 'account'" class="st-panel">
        <div class="wazo-info-card">
          <div class="info-label">Thông tin kết nối máy chủ tổng đài:</div>
          <div class="info-content">
            <strong>Tài khoản:</strong> {{ currentUsername }} • <strong>Máy lẻ SIP:</strong>
            {{ currentExt }}
          </div>
          <div class="info-sip">{{ sipHostInfo }}</div>
        </div>

        <div class="st-field-group">
          <label class="st-label">Mật khẩu hiện tại:</label>
          <input
            v-model="oldPassword"
            type="password"
            class="st-input"
            placeholder="Nhập mật khẩu hiện tại..."
          />
        </div>
        <div class="st-field-group">
          <label class="st-label">Mật khẩu mới:</label>
          <input
            v-model="newPassword"
            type="password"
            class="st-input"
            placeholder="Tối thiểu 8 ký tự..."
          />
        </div>
        <div class="st-field-group">
          <label class="st-label">Nhập lại mật khẩu mới:</label>
          <input
            v-model="confirmPassword"
            type="password"
            class="st-input"
            placeholder="Xác nhận mật khẩu mới..."
          />
        </div>
        <div class="password-action-row">
          <button class="btn-primary" :disabled="passwordLoading" @click="savePassword">
            {{ passwordLoading ? 'Đang cập nhật...' : 'Cập nhật mật khẩu' }}
          </button>
          <button
            type="button"
            class="btn-reset-email"
            :disabled="resetEmailLoading"
            @click="sendPasswordResetEmail"
          >
            <template v-if="resetEmailLoading">Đang gửi...</template>
            <template v-else><UiIcon name="email" /> Gửi liên kết đặt lại qua Email</template>
          </button>
        </div>
      </div>

      <!-- Tab 4: Cấu hình Phân hệ tính năng -->
      <div v-show="activeTab === 'features'" class="st-panel">
        <div class="features-intro">
          <strong>Cấu hình Bật / Tắt 3 phân hệ màn hình (Feature Flags):</strong>
          <small
            >Ẩn/hiện linh hoạt từng màn hình trên Sidebar và Menu để phục vụ quản trị ứng
            dụng.</small
          >
        </div>

        <div class="features-grid">
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.calls" />
            <span class="feature-name"
              ><UiIcon name="phone-text" /> Gọi điện & Danh bạ (/calls)</span
            >
          </label>
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.callGroups" />
            <span class="feature-name">Gọi nhóm (/call-groups)</span>
          </label>
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.history" />
            <span class="feature-name"><UiIcon name="history" /> Lịch sử cuộc gọi (/history)</span>
          </label>
        </div>

        <div class="reset-row">
          <button class="btn-reset-features" @click="handleResetFeatures">
            <UiIcon name="refresh" /> Khôi phục mặc định toàn bộ cờ
          </button>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn-secondary" @click="$emit('close')">Đóng</button>
        <button class="btn-primary" :disabled="saving" @click="handleSave">
          {{ saving ? 'Đang lưu...' : 'Lưu cài đặt' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import UiIcon, { iconGlyphs } from '@/components/common/UiIcon.vue'
import { useMicrophoneMeter } from '../../composables/useMicrophoneMeter.js'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { getFeatures, saveFeatures, resetFeatures } from '@/config/features.js'
import { authService, phoneAdapter, settingsService } from '@/services/index.js'
import { logger } from '@/services/common/loggerService.js'
import { userSessionState } from '@/state/sessionState.js'
import { captureSessionContext, isSessionContextCurrent } from '@/services/auth/sessionScope.js'

const props = defineProps({
  isOpen: Boolean,
})

const emit = defineEmits(['close'])

/**
 * Đọc tên hiển thị hiện tại cho phần tài khoản trong Settings; không dùng tên này làm login
 * identifier.
 */
const currentUsername = computed(
  () => userSessionState.displayName || authService.getCurrentDisplayName() || 'Người dùng',
)
/** Đọc máy lẻ của phiên hiện tại cho phần thông tin tài khoản/SIP. */
const currentExt = computed(
  () => userSessionState.extension || authService.getCurrentExtension() || '',
)
/** Chuẩn hóa host tổng đài để người dùng kiểm tra đúng môi trường đang kết nối. */
function formatSipHostInfo() {
  const host = (authService.host || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .split(':')[0]
  return `sip:${currentExt.value}@${host || 'smartcall'}`
}

/** Chuỗi địa chỉ SIP dùng để hiển thị thông tin tài khoản trên máy chủ tổng đài. */
const sipHostInfo = computed(formatSipHostInfo)

const activeTab = ref('audio')
const featureConfig = ref(getFeatures())

// Danh sách thiết bị thật từ máy tính
const availableMics = ref([])
const availableSpeakers = ref([])
const selectedMic = ref(localStorage.getItem('smartcall_selected_mic') || 'default')
const selectedSpeaker = ref(localStorage.getItem('smartcall_selected_speaker') || 'default')
const ringtoneVol = ref(80)

/** Chỉ cho phép VU Meter hoạt động khi modal Cài đặt đang mở ở tab Âm thanh. */
function isAudioMeterActive() {
  return props.isOpen && activeTab.value === 'audio'
}

/** Đọc ID micro đang được chọn trong form cài đặt để mở đúng thiết bị đo. */
function getSelectedMicrophoneId() {
  return selectedMic.value
}

const { micLevel, isVoiceActive, micStatusText, startMicMeter, stopMicMeter } = useMicrophoneMeter({
  isActive: isAudioMeterActive,
  getMicrophoneId: getSelectedMicrophoneId,
})

/** Dừng track micro tạm thời sau khi xin quyền đọc tên thiết bị âm thanh. */
function stopMediaTrack(track) {
  track.stop()
}

/** Kiểm tra thiết bị MediaDeviceInfo là micro đầu vào. */
function isAudioInputDevice(device) {
  return device.kind === 'audioinput'
}

/** Chuẩn hóa thiết bị micro đầu vào thành cặp deviceId/label để hiển thị trong dropdown. */
function mapMicrophoneDevice(device, index) {
  return {
    deviceId: device.deviceId,
    label: device.label || `Microphone ${index + 1} (${device.deviceId.slice(0, 8)}...)`,
  }
}

/** Kiểm tra thiết bị MediaDeviceInfo là loa hoặc tai nghe đầu ra. */
function isAudioOutputDevice(device) {
  return device.kind === 'audiooutput'
}

/** Chuẩn hóa thiết bị đầu ra thành cặp deviceId/label để hiển thị trong dropdown. */
function mapSpeakerDevice(device, index) {
  return {
    deviceId: device.deviceId,
    label: device.label || `Loa / Tai nghe ${index + 1} (${device.deviceId.slice(0, 8)}...)`,
  }
}

/** Quét danh sách thiết bị micro/loa thật của máy khách và chọn mặc định nếu chưa có cấu hình. */
const loadAudioDevices = async () => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return

  try {
    // Xin quyền nhẹ để trình duyệt cung cấp nhãn thiết bị đầy đủ (label).
    if (navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(stopMediaTrack)
      } catch {
        // Bỏ qua nếu người dùng từ chối quyền mic; vẫn liệt kê danh sách deviceId hiện có.
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics = devices.filter(isAudioInputDevice).map(mapMicrophoneDevice)
    const speakers = devices.filter(isAudioOutputDevice).map(mapSpeakerDevice)

    availableMics.value = mics
    availableSpeakers.value = speakers

    if (mics.length > 0 && (!selectedMic.value || selectedMic.value === 'default')) {
      selectedMic.value = mics[0].deviceId
    }
    if (speakers.length > 0 && (!selectedSpeaker.value || selectedSpeaker.value === 'default')) {
      selectedSpeaker.value = speakers[0].deviceId
    }
  } catch (err) {
    logger.warn('AUDIO', 'Lỗi quét thiết bị âm thanh:', err)
  }
}

/** Nạp lại danh sách thiết bị âm thanh rồi khởi động VU meter kiểm tra micro. */
async function loadAudioDevicesAndStartMeter() {
  await loadAudioDevices()
  await startMicMeter()
}

/** Khởi động lại phép đo VU meter khi đổi thiết bị micro trong dropdown. */
const restartMicMeter = () => startMicMeter()

/** Đồng bộ tab và tài nguyên micro/dịch vụ mỗi khi modal Cài đặt được mở hoặc đóng. */
function onModalVisibilityChange(isModalOpen) {
  if (isModalOpen) {
    featureConfig.value = getFeatures()
    if (activeTab.value === 'audio') {
      void loadAudioDevicesAndStartMeter()
    } else if (activeTab.value === 'calls') {
      void loadCallServices()
    }
  } else {
    stopMicMeter()
  }
}

/** Bật/tắt VU meter hoặc nạp cấu hình PBX tương ứng khi người dùng chuyển tab trong Settings. */
function onActiveTabChange(tab) {
  if (props.isOpen && tab === 'audio') {
    void loadAudioDevicesAndStartMeter()
  } else {
    stopMicMeter()
  }
  if (props.isOpen && tab === 'calls') {
    void loadCallServices()
  }
}

/** Khởi tạo dữ liệu thiết bị hoặc PBX nếu SettingsModal đang ở trạng thái mở ngay lúc mount. */
function initSettingsOnMount() {
  if (!props.isOpen) return
  if (activeTab.value === 'audio') {
    void loadAudioDevicesAndStartMeter()
  } else if (activeTab.value === 'calls') {
    void loadCallServices()
  }
}

watch(() => props.isOpen, onModalVisibilityChange)
watch(() => activeTab.value, onActiveTabChange)
onMounted(initSettingsOnMount)
onUnmounted(stopMicMeter)

/** Khôi phục các cờ màn hình mặc định và cập nhật form Settings. */
const handleResetFeatures = () => {
  featureConfig.value = resetFeatures()
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `${iconGlyphs['refresh']} Đã khôi phục tất cả cờ tính năng về mặc định!` },
    }),
  )
}

const dndEnabled = ref(false)
const autoRecordCalls = ref(localStorage.getItem('smartcall_auto_record_calls') === 'true')
const forwardBusy = ref('')
const forwardNoAnswer = ref('')
const forwardAll = ref('')
const serviceBaseline = ref({ dnd: null, forwards: null })
const saving = ref(false)
let servicesLoadId = 0

/** Xóa sạch state dịch vụ tổng đài và ô mật khẩu khi người dùng đổi tài khoản/phiên làm việc. */
function resetSessionServicesState() {
  servicesLoadId += 1
  serviceBaseline.value = { dnd: null, forwards: null }
  dndEnabled.value = false
  forwardBusy.value = forwardNoAnswer.value = forwardAll.value = ''
  oldPassword.value = newPassword.value = confirmPassword.value = ''
  stopMicMeter()
}

watch(() => userSessionState.userUuid, resetSessionServicesState)

/**
 * Lưu tùy chọn tự ghi âm của máy khách để luồng nghe máy biết có cần bắt đầu ghi âm server hay
 * không.
 */
const saveAutoRecord = () => {
  localStorage.setItem('smartcall_auto_record_calls', autoRecordCalls.value ? 'true' : 'false')
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: autoRecordCalls.value
          ? `${iconGlyphs['status-busy']} Đã bật tính năng Tự động ghi âm cuộc gọi`
          : `${iconGlyphs['status-idle']} Đã tắt tính năng Tự động ghi âm cuộc gọi`,
        type: 'info',
      },
    }),
  )
}

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordLoading = ref(false)
const resetEmailLoading = ref(false)

/**
 * Tải DND và chuyển tiếp từ Confd, giữ trạng thái chưa tải khi API lỗi để không ghi đè bằng giá
 * trị mặc định.
 */
const loadCallServices = async () => {
  const loadId = ++servicesLoadId,
    context = captureSessionContext()
  try {
    const result = await settingsService.loadCallServices()
    if (loadId !== servicesLoadId || !isSessionContextCurrent(context)) return
    if (result.dnd !== null) {
      dndEnabled.value = result.dnd
      serviceBaseline.value.dnd = result.dnd
    }
    if (result.forwards) {
      forwardBusy.value = result.forwards.busy
      forwardNoAnswer.value = result.forwards.noanswer
      forwardAll.value = result.forwards.unconditional
      serviceBaseline.value.forwards = { ...result.forwards }
    }
    if (result.errors.length)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            type: 'warning',
            message: 'Chưa tải đủ dịch vụ. Những trường chưa tải sẽ không được ghi.',
          },
        }),
      )
  } catch (error) {
    if (isSessionContextCurrent(context))
      window.dispatchEvent(
        new CustomEvent('app-toast', { detail: { type: 'warning', message: error.message } }),
      )
  }
}

/** Phát âm thanh kiểm tra trên loa được chọn để người dùng xác nhận thiết bị đầu ra. */
const testSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime

    /** Phát một nốt nhạc kiểm tra theo tần số và thứ tự trễ để tạo hợp âm thử loa. */
    function playTestToneNote(freq, idx) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + idx * 0.16)
      gain.gain.setValueAtTime(0.2, now + idx * 0.16)
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.28)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + idx * 0.16)
      osc.stop(now + idx * 0.16 + 0.28)
    }

    // Chuỗi 3 nốt nhạc C5 - E5 - G5 để kiểm tra loa đầu ra thật.
    const notes = [523.25, 659.25, 783.99]
    notes.forEach(playTestToneNote)

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['speaker']} Đang phát âm thanh kiểm tra loa (3 nốt nhạc)!`,
          type: 'info',
        },
      }),
    )
  } catch (e) {
    logger.warn('AUDIO', 'Lỗi thử loa:', e)
  }
}

/**
 * Kiểm tra mật khẩu mới/xác nhận rồi gọi AuthService đổi mật khẩu; giữ nguyên khoảng trắng của
 * credential.
 */
const savePassword = async () => {
  const oldP = oldPassword.value
  const newP = newPassword.value
  const confP = confirmPassword.value

  if (!oldP || !newP || !confP) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['warning']} Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  if (newP.length < 8) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['warning']} Mật khẩu mới phải có tối thiểu 8 ký tự!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  if (newP !== confP) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['warning']} Mật khẩu mới và xác nhận mật khẩu không khớp!`,
          type: 'warning',
        },
      }),
    )
    return
  }

  passwordLoading.value = true
  try {
    const res = await authService.changePassword(oldP, newP)

    if (res.status === 204 || res.ok) {
      oldPassword.value = ''
      newPassword.value = ''
      confirmPassword.value = ''
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `${iconGlyphs['success-text']} Đổi mật khẩu thành công! Vui lòng ghi nhớ mật khẩu mới.`,
            type: 'success',
          },
        }),
      )
    } else {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `${iconGlyphs['error-text']} Đổi mật khẩu thất bại: Mật khẩu hiện tại không chính xác hoặc không hợp lệ.`,
            type: 'error',
          },
        }),
      )
    }
  } catch (err) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['error-text']} Lỗi khi gửi yêu cầu đổi mật khẩu: ${err.message}`,
          type: 'error',
        },
      }),
    )
  } finally {
    passwordLoading.value = false
  }
}

/** Gửi yêu cầu reset bằng tên đăng nhập thật đã lưu, không suy tài khoản từ tên hiển thị. */
const sendPasswordResetEmail = async () => {
  const username =
    localStorage.getItem('smartcall_login_username') || authService.session?.username || ''
  if (!username) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['warning']} Không xác định được tên đăng nhập để gửi email đặt lại.`,
          type: 'warning',
        },
      }),
    )
    return
  }
  resetEmailLoading.value = true
  try {
    const res = await authService.resetPassword(username)
    if (res.ok || res.status === 204 || res.status === 200) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `${iconGlyphs['email']} Đã gửi liên kết đặt lại mật khẩu tới hòm thư email của bạn. Vui lòng kiểm tra hộp thư đến!`,
            type: 'success',
          },
        }),
      )
    } else if (res.status === 503) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `${iconGlyphs['warning']} Dịch vụ thư điện tử (Mail Server) của tổng đài chưa được cấu hình.`,
            type: 'warning',
          },
        }),
      )
    } else {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `${iconGlyphs['error-text']} Không thể gửi yêu cầu đặt lại mật khẩu (Mã lỗi: ${res.status}).`,
            type: 'error',
          },
        }),
      )
    }
  } catch (e) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `${iconGlyphs['error-text']} Lỗi khi kết nối tới máy chủ tổng đài: ${e.message}`,
          type: 'error',
        },
      }),
    )
  } finally {
    resetEmailLoading.value = false
  }
}

/**
 * Lưu thiết bị và các dịch vụ tổng đài đã tải/thay đổi; lỗi từng phần không được báo thành công
 * toàn bộ.
 */
const handleSave = async () => {
  if (saving.value) return
  saving.value = true
  const context = captureSessionContext()
  try {
    await phoneAdapter.applyAudioDevices({
      microphoneId: selectedMic.value,
      speakerId: selectedSpeaker.value,
    })
    if (!isSessionContextCurrent(context)) return
    localStorage.setItem('smartcall_selected_mic', selectedMic.value)
    localStorage.setItem('smartcall_selected_speaker', selectedSpeaker.value)
    saveFeatures(featureConfig.value)
    const result = await settingsService.saveCallServices(
      {
        dnd: dndEnabled.value,
        forwards: {
          busy: forwardBusy.value,
          noanswer: forwardNoAnswer.value,
          unconditional: forwardAll.value,
        },
      },
      serviceBaseline.value,
    )
    if (!isSessionContextCurrent(context)) return
    serviceBaseline.value = result.baseline
    if (result.failures.length)
      throw new Error('Chưa lưu được một số dịch vụ: ' + result.failures.join('; '))
    localStorage.setItem('smartcall_auto_record_calls', autoRecordCalls.value ? 'true' : 'false')
    stopMicMeter()
    emit('close')
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { type: 'success', message: 'Đã lưu các cài đặt đã thay đổi.' },
      }),
    )
  } catch (error) {
    if (isSessionContextCurrent(context))
      window.dispatchEvent(
        new CustomEvent('app-toast', { detail: { type: 'error', message: error.message } }),
      )
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
}

.modal-card-lg {
  width: 640px;
  max-width: 95vw;
}

.modal-head {
  padding: 16px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #1e293b;
  font-size: 1rem;
}

.head-title small {
  font-weight: normal;
  color: #64748b;
  font-size: 0.8rem;
}

.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  color: #64748b;
}

.btn-close:hover {
  color: #1e293b;
}

.settings-nav-tabs {
  display: flex;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 16px;
  gap: 4px;
}

.st-tab-btn {
  padding: 10px 14px;
  border: none;
  background: transparent;
  font-size: 0.85rem;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  margin-bottom: -1px;
}

.st-tab-btn:hover {
  color: #1e293b;
}

.st-tab-btn.active {
  color: #1e88e5;
  border-bottom-color: #1e88e5;
  background: white;
}

.st-panel {
  padding: 20px;
}

.st-field-group {
  margin-bottom: 16px;
}

.st-label {
  display: block;
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
  margin-bottom: 6px;
}

.st-select,
.st-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
  outline: none;
}

.st-select:focus,
.st-input:focus {
  border-color: #1e88e5;
}

.output-row {
  display: flex;
  gap: 8px;
}

.btn-test-sound {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.vol-slider {
  width: 100%;
}

.mic-meter-box {
  background: #0f172a;
  border-radius: 6px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.meter-text {
  font-size: 0.75rem;
  color: #94a3b8;
}

.mic-meter-bar {
  flex: 1;
  height: 8px;
  background: #1e293b;
  border-radius: 4px;
  overflow: hidden;
}

.mic-meter-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e 0%, #eab308 70%, #ef4444 100%);
  border-radius: 4px;
  transition: width 0.08s ease-out;
}

.meter-status {
  font-size: 0.75rem;
  color: #94a3b8;
  font-weight: 500;
  min-width: 190px;
  text-align: right;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.meter-status.active {
  color: #4ade80;
  font-weight: 600;
}

.st-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}

.st-toggle-info strong {
  display: block;
  font-size: 0.88rem;
  color: #1e293b;
}

.st-toggle-info small {
  color: #64748b;
  font-size: 0.78rem;
}

.toggle-cb {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.forwards-section {
  margin-top: 16px;
}

.wazo-info-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}

.info-label {
  font-size: 0.8rem;
  color: #64748b;
  margin-bottom: 4px;
}

.info-content {
  font-size: 0.88rem;
}

.info-sip {
  font-size: 0.82rem;
  color: #3b82f6;
  font-family: monospace;
  margin-top: 4px;
}

.modal-foot {
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-primary {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary {
  background: #94a3b8;
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 6px;
  cursor: pointer;
}

/* --- Features Tab Styles --- */
.features-intro {
  margin-bottom: 16px;
  background: #f1f5f9;
  padding: 10px 14px;
  border-radius: 8px;
  border-left: 4px solid #1e88e5;
}

.features-intro strong {
  display: block;
  font-size: 0.9rem;
  color: #0f172a;
}

.features-intro small {
  display: block;
  font-size: 0.8rem;
  color: #64748b;
  margin-top: 2px;
}

.features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f8fafc;
  padding: 10px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.feature-item:hover {
  background: #eff6ff;
  border-color: #93c5fd;
}

.feature-item input[type='checkbox'] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.feature-name {
  font-size: 0.86rem;
  font-weight: 500;
  color: #1e293b;
}

.reset-row {
  display: flex;
  justify-content: flex-start;
  margin-top: 10px;
}

.btn-reset-features {
  background: transparent;
  color: #64748b;
  border: 1px dashed #cbd5e1;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reset-features:hover {
  color: #ef4444;
  border-color: #fca5a5;
  background: #fef2f2;
}

.password-action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.btn-reset-email {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #2563eb;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reset-email:hover:not(:disabled) {
  background: #e2e8f0;
  color: #1d4ed8;
}

.btn-reset-email:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
