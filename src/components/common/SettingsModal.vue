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
          🚩 Phân hệ & Mock Data
        </button>
      </div>

      <!-- Tab 1: Âm thanh & WebRTC -->
      <div v-show="activeTab === 'audio'" class="st-panel">
        <div class="st-field-group">
          <label class="st-label">Microphone thu âm (Audio Input):</label>
          <select v-model="selectedMic" class="st-select">
            <option value="default">Microphone Array (Realtek High Definition Audio)</option>
            <option value="headset">Headset Microphone (Jabra Evolve 65 Link)</option>
            <option value="sys">Default System Microphone</option>
          </select>

          <div class="mic-meter-box">
            <span class="meter-text">Tín hiệu Micro:</span>
            <div class="mic-meter-bar">
              <div class="mic-meter-fill"></div>
            </div>
            <span class="meter-status">Hoạt động tốt</span>
          </div>
        </div>

        <div class="st-field-group">
          <label class="st-label">Loa / Tai nghe phát tiếng (Audio Output):</label>
          <div class="output-row">
            <select v-model="selectedSpeaker" class="st-select">
              <option value="headset">Headset Earphone (Jabra Evolve 65 Link)</option>
              <option value="speakers">Speakers / Headphones (Realtek Audio)</option>
              <option value="sys">Default System Audio Output</option>
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

      <!-- Tab 5: Cấu hình Phân hệ & Dữ liệu Mock -->
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

        <div class="mock-data-section">
          <div class="st-toggle-row">
            <div class="st-toggle-info">
              <strong style="color: #2563eb;">⚡ Cho phép dữ liệu thử nghiệm (Mock Data & Offline Mode)</strong>
              <small>
                • <strong>KHI BẬT:</strong> Hiển thị nút "Chạy chế độ thử nghiệm Offline" ở trang Login và dùng dữ liệu mẫu khi mất kết nối Wazo.<br>
                • <strong>KHI TẮT:</strong> Hệ thống chỉ chạy 100% dữ liệu thật từ máy chủ Wazo. Nếu máy chủ trả về rỗng hoặc lỗi, màn hình sẽ để trắng danh sách, tuyệt đối không dùng dữ liệu fake.
              </small>
            </div>
            <input v-model="featureConfig.mockData" type="checkbox" class="toggle-cb" />
          </div>
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
import { ref, watch } from 'vue'
import { getFeatures, saveFeatures, resetFeatures } from '@/config/features'

const props = defineProps({
  isOpen: Boolean,
})

const emit = defineEmits(['close'])

const activeTab = ref('audio')
const featureConfig = ref(getFeatures())

watch(
  () => props.isOpen,
  (val) => {
    if (val) {
      featureConfig.value = getFeatures()
    }
  },
)

const handleResetFeatures = () => {
  featureConfig.value = resetFeatures()
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '🔄 Đã khôi phục tất cả cờ tính năng về mặc định!' },
    }),
  )
}

const selectedMic = ref('default')
const selectedSpeaker = ref('headset')
const ringtoneVol = ref(80)

const dndEnabled = ref(false)
const forwardBusy = ref('1002')
const forwardNoAnswer = ref('1003')
const forwardAll = ref('')

const selectedLang = ref('vi')
const notifyDesktop = ref(true)
const notifySound = ref(true)

const testSound = () => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '🔊 Đang phát âm thanh thử nghiệm qua loa/tai nghe...' },
    }),
  )
}

const savePassword = () => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '✅ Đã gửi yêu cầu đổi mật khẩu tới Wazo Auth!' },
    }),
  )
}

const handleSave = () => {
  saveFeatures(featureConfig.value)
  emit('close')
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: '✅ Đã lưu cấu hình Cài đặt và Cờ phân hệ thành công!' },
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
  width: 60%;
  background: linear-gradient(90deg, #22c55e, #eab308, #ef4444);
  border-radius: 4px;
  animation: micPulse 1.2s infinite alternate ease-in-out;
}

@keyframes micPulse {
  from {
    width: 20%;
  }
  to {
    width: 80%;
  }
}

.meter-status {
  font-size: 0.75rem;
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

.mock-data-section {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 16px;
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

