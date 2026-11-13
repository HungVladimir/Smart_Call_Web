<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card modal-card-lg">
      <div class="modal-head">
        <div class="head-title">
          <span>⚙️ CÀI ĐẶT HỆ THỐNG (SETTINGS)</span>
          <small>• SmartCall Web v2.0</small>
        </div>
        <button class="btn-close" @click="$emit('close')">✖</button>
      </div>

      <!-- Settings Navigation Tabs -->
      <div class="settings-nav-tabs">
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'audio' }"
          @click="activeTab = 'audio'"
        >
          🎙️ Âm thanh & WebRTC
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'calls' }"
          @click="activeTab = 'calls'"
        >
          📞 Dịch vụ cuộc gọi (PBX)
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'account' }"
          @click="activeTab = 'account'"
        >
          🔒 Tài khoản & Mật khẩu
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'pref' }"
          @click="activeTab = 'pref'"
        >
          🌐 Ngôn ngữ & Tùy chọn
        </button>
        <button
          class="st-tab-btn"
          :class="{ active: activeTab === 'features' }"
          @click="activeTab = 'features'"
        >
          🚩 Phân hệ tính năng
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
            <span class="meter-status" :class="{ active: micLevel > 5 }">{{ micStatusText }}</span>
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
            <button class="btn-test-sound" @click="testSound">🔊 Thử loa</button>
          </div>
        </div>

        <div class="st-field-group">
          <label class="st-label">Âm lượng chuông gọi đến (Ringtone Volume): {{ ringtoneVol }}%</label>
          <input v-model="ringtoneVol" type="range" min="0" max="100" class="vol-slider" />
        </div>
      </div>

      <!-- Tab 2: Dịch vụ cuộc gọi (Theo dev_guide.md) -->
      <div v-show="activeTab === 'calls'" class="st-panel">
        <div class="st-toggle-row">
          <div class="st-toggle-info">
            <strong>Không làm phiền (Do Not Disturb - DND)</strong>
            <small>Tự động từ chối và chặn đổ chuông tất cả cuộc gọi đến khi bạn đang họp hoặc bận việc.</small>
          </div>
          <input v-model="dndEnabled" type="checkbox" class="toggle-cb" />
        </div>

        <div class="forwards-section">
          <strong>Chuyển tiếp cuộc gọi (Call Forwarding):</strong>

          <div class="st-field-group">
            <label class="st-label">Chuyển tiếp khi Bận (Forward when Busy):</label>
            <input v-model="forwardBusy" type="text" class="st-input" placeholder="Nhập số máy lẻ chuyển tiếp (VD: 1002)..." />
          </div>

          <div class="st-field-group">
            <label class="st-label">Chuyển tiếp khi Không trả lời sau 20s (Forward on No Answer):</label>
            <input v-model="forwardNoAnswer" type="text" class="st-input" placeholder="Nhập số máy lẻ (VD: 1003)..." />
          </div>

          <div class="st-field-group">
            <label class="st-label">Chuyển tiếp vô điều kiện (Unconditional Forwarding):</label>
            <input v-model="forwardAll" type="text" class="st-input" placeholder="Để trống nếu không muốn chuyển tiếp toàn bộ..." />
          </div>
        </div>
      </div>

      <!-- Tab 3: Tài khoản & Mật khẩu -->
      <div v-show="activeTab === 'account'" class="st-panel">
        <div class="wazo-info-card">
          <div class="info-label">Thông tin kết nối tổng đài Wazo:</div>
          <div class="info-content">
            <strong>Tài khoản:</strong> admin • <strong>Máy lẻ SIP:</strong> 1001
          </div>
          <div class="info-sip">sip:1001@107.126.11.126 • Tenant: lan-company</div>
        </div>

        <div class="st-field-group">
          <label class="st-label">Mật khẩu hiện tại:</label>
          <input type="password" class="st-input" placeholder="Nhập mật khẩu hiện tại..." />
        </div>
        <div class="st-field-group">
          <label class="st-label">Mật khẩu mới:</label>
          <input type="password" class="st-input" placeholder="Tối thiểu 8 ký tự..." />
        </div>
        <div class="st-field-group">
          <label class="st-label">Nhập lại mật khẩu mới:</label>
          <input type="password" class="st-input" placeholder="Xác nhận mật khẩu mới..." />
        </div>
        <button class="btn-primary" @click="savePassword">Cập nhật mật khẩu</button>
      </div>

      <!-- Tab 4: Ngôn ngữ & Tùy chọn -->
      <div v-show="activeTab === 'pref'" class="st-panel">
        <div class="st-field-group">
          <label class="st-label">Ngôn ngữ giao diện (Language / 언어):</label>
          <select v-model="selectedLang" class="st-select">
            <option value="vi">Tiếng Việt (Vietnamese)</option>
            <option value="ko">한국어 (Korean - Dành cho chuyên gia Hàn Quốc)</option>
            <option value="en">English (Tiếng Anh)</option>
          </select>
          <small class="hint-text">
            Hỗ trợ chuyển đổi nhanh cho nhân viên Việt Nam và chuyên gia Hàn Quốc tại SDV.
          </small>
        </div>

        <div class="st-toggle-row">
          <div class="st-toggle-info">
            <strong>Thông báo nổi trên màn hình (Desktop Notifications)</strong>
            <small>Hiện thông báo popup góc màn hình khi có cuộc gọi đến hoặc tin nhắn mới.</small>
          </div>
          <input v-model="notifyDesktop" type="checkbox" class="toggle-cb" />
        </div>

        <div class="st-toggle-row">
          <div class="st-toggle-info">
            <strong>Âm thanh thông báo tin nhắn (Chat Sound)</strong>
            <small>Phát tiếng chuông nhẹ khi nhận được tin nhắn mới trong phòng chat.</small>
          </div>
          <input v-model="notifySound" type="checkbox" class="toggle-cb" />
        </div>
      </div>

      <!-- Tab 5: Cấu hình Phân hệ tính năng -->
      <div v-show="activeTab === 'features'" class="st-panel">
        <div class="features-intro">
          <strong>Cấu hình Bật / Tắt 5 phân hệ màn hình (Feature Flags):</strong>
          <small>Ẩn/hiện linh hoạt từng màn hình trên Sidebar và Menu để phục vụ báo cáo tiến độ giai đoạn.</small>
        </div>

        <div class="features-grid">
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.dashboard" />
            <span class="feature-name">📊 Tổng quan (/dashboard)</span>
          </label>
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.calls" />
            <span class="feature-name">📞 Gọi điện & Bàn phím (/calls)</span>
          </label>
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.contacts" />
            <span class="feature-name">📇 Danh bạ nội bộ (/contacts)</span>
          </label>
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.messages" />
            <span class="feature-name">💬 Tin nhắn phòng chat (/messages)</span>
          </label>
          <label class="feature-item">
            <input type="checkbox" v-model="featureConfig.history" />
            <span class="feature-name">🕒 Lịch sử cuộc gọi (/history)</span>
          </label>
        </div>

        <div class="reset-row">
          <button class="btn-reset-features" @click="handleResetFeatures">🔄 Khôi phục mặc định toàn bộ cờ</button>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn-secondary" @click="$emit('close')">Đóng</button>
        <button class="btn-primary" @click="handleSave">Lưu cài đặt</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { getFeatures, saveFeatures, resetFeatures } from '@/config/features'

const props = defineProps({
  isOpen: Boolean,
})

const emit = defineEmits(['close'])

const activeTab = ref('audio')
const featureConfig = ref(getFeatures())

// Danh sách thiết bị thật từ máy tính
const availableMics = ref([])
const availableSpeakers = ref([])
const selectedMic = ref(localStorage.getItem('smartcall_selected_mic') || 'default')
const selectedSpeaker = ref(localStorage.getItem('smartcall_selected_speaker') || 'default')
const ringtoneVol = ref(80)

// Quản lý VU Meter đo tín hiệu Micro thật
const micLevel = ref(0)
const micStatusText = computed(() => {
  if (micLevel.value > 15) return '🟢 Đang thu âm giọng nói'
  if (micLevel.value > 2) return '🟡 Tín hiệu micro nhẹ'
  return '⚪ Sẵn sàng (Hãy nói vào mic để thử)'
})

let audioContext = null
let analyser = null
let micStream = null
let animFrameId = null

const loadAudioDevices = async () => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return

  try {
    // Xin quyền nhẹ để lấy tên đầy đủ của thiết bị (label)
    if (navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
      } catch {
        /* ignore nếu user đã cấp hoặc hủy */
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices()
    const mics = devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1} (${d.deviceId.slice(0, 8)}...)`,
      }))
    const speakers = devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Loa / Tai nghe ${i + 1} (${d.deviceId.slice(0, 8)}...)`,
      }))

    availableMics.value = mics
    availableSpeakers.value = speakers

    if (mics.length > 0 && (!selectedMic.value || selectedMic.value === 'default')) {
      selectedMic.value = mics[0].deviceId
    }
    if (speakers.length > 0 && (!selectedSpeaker.value || selectedSpeaker.value === 'default')) {
      selectedSpeaker.value = speakers[0].deviceId
    }
  } catch (err) {
    console.warn('Lỗi quét thiết bị âm thanh:', err)
  }
}

const startMicMeter = async () => {
  stopMicMeter()
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

  try {
    const constraints = {
      audio:
        selectedMic.value && selectedMic.value !== 'default'
          ? { deviceId: { exact: selectedMic.value } }
          : true,
    }
    micStream = await navigator.mediaDevices.getUserMedia(constraints)
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    audioContext = new AudioCtx()
    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.4

    const source = audioContext.createMediaStreamSource(micStream)
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const updateVolume = () => {
      if (!analyser) return
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const avg = sum / dataArray.length
      // Chuẩn hóa mức âm lượng từ 0% đến 100%
      micLevel.value = Math.min(100, Math.round((avg / 64) * 100))
      animFrameId = requestAnimationFrame(updateVolume)
    }
    updateVolume()
  } catch (e) {
    micLevel.value = 0
    console.warn('Lỗi kết nối Micro đo tín hiệu VU:', e)
  }
}

const stopMicMeter = () => {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop())
    micStream = null
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {})
    audioContext = null
  }
  micLevel.value = 0
}

const restartMicMeter = () => {
  localStorage.setItem('smartcall_selected_mic', selectedMic.value)
  startMicMeter()
}

watch(
  () => props.isOpen,
  (val) => {
    if (val) {
      featureConfig.value = getFeatures()
      if (activeTab.value === 'audio') {
        loadAudioDevices().then(() => startMicMeter())
      }
    } else {
      stopMicMeter()
    }
  },
)

watch(
  () => activeTab.value,
  (tab) => {
    if (props.isOpen && tab === 'audio') {
      loadAudioDevices().then(() => startMicMeter())
    } else {
      stopMicMeter()
    }
  },
)

onMounted(() => {
  if (props.isOpen && activeTab.value === 'audio') {
    loadAudioDevices().then(() => startMicMeter())
  }
})

onUnmounted(() => {
  stopMicMeter()
})

const handleResetFeatures = () => {
  featureConfig.value = resetFeatures()
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '🔄 Đã khôi phục tất cả cờ tính năng về mặc định!' },
    }),
  )
}

const dndEnabled = ref(false)
const forwardBusy = ref('1002')
const forwardNoAnswer = ref('1003')
const forwardAll = ref('')

const selectedLang = ref('vi')
const notifyDesktop = ref(true)
const notifySound = ref(true)

const testSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime

    // Chuỗi 3 nốt nhạc du dương C5 - E5 - G5 để test loa thật
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((freq, idx) => {
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
    })

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: '🔊 Đang phát âm thanh kiểm tra loa (3 nốt nhạc)!', type: 'info' },
      }),
    )
  } catch (e) {
    console.warn('Lỗi thử loa:', e)
  }
}

const savePassword = () => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '✅ Đã gửi yêu cầu đổi mật khẩu tới Wazo Auth!' },
    }),
  )
}

const handleSave = () => {
  localStorage.setItem('smartcall_selected_mic', selectedMic.value)
  localStorage.setItem('smartcall_selected_speaker', selectedSpeaker.value)
  saveFeatures(featureConfig.value)
  stopMicMeter()
  emit('close')
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '✅ Đã lưu cấu hình Cài đặt, Thiết bị âm thanh và Phân hệ thành công!' },
    }),
  )
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
  transition: width 0.06s ease-out;
}

.meter-status {
  font-size: 0.75rem;
  color: #94a3b8;
  font-weight: 500;
  min-width: 175px;
  text-align: right;
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

.hint-text {
  color: #64748b;
  font-size: 0.75rem;
  display: block;
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

.feature-item input[type="checkbox"] {
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
</style>

