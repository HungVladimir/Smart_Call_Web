<template>
  <div class="messages-view">
    <div class="chat-container">
      <!-- 1. CỘT DANH SÁCH PHÒNG CHAT (THEO APP1) -->
      <div class="chat-rooms-col">
        <div class="rooms-header">
          <h2>Tin nhắn</h2>
          <button class="btn-new-room" @click="openAddMemberModal">+ Tạo nhóm</button>
        </div>

        <div class="room-list">
          <div
            v-for="room in rooms"
            :key="room.id"
            class="room-item"
            :class="{ active: currentRoom.id === room.id }"
            @click="selectRoom(room)"
          >
            <div class="avatar-sm" :style="{ backgroundColor: room.avatarBg }">
              {{ room.icon || room.title.slice(0, 2) }}
            </div>

            <div class="room-info">
              <div class="room-top">
                <span class="room-title">{{ room.title }}</span>
                <span class="room-time">{{ room.time }}</span>
              </div>
              <div class="room-bottom">
                <span class="room-preview">{{ room.preview }}</span>
                <span v-if="room.unread" class="badge-unread">{{ room.unread }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. CỘT KHUNG CHAT CHI TIẾT (THEO APP2) -->
      <div class="chat-main-col">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="chat-title-group">
            <h3>{{ currentRoom.title }}</h3>
            <span class="online-indicator">● Đang hoạt động (31 thành viên)</span>
          </div>

          <div class="chat-header-actions">
            <button class="btn-action" title="Gọi thoại cho nhóm" @click="startVoiceCall">📞</button>
            <button class="btn-action" title="Gọi video nhóm" @click="startVideoCall">🎥</button>
            <button class="btn-manage-members" @click="openAddMemberModal">👥 Thành viên</button>
          </div>
        </div>

        <!-- Thanh thông báo ghim (Theo app2.webp) -->
        <div v-if="showPinned" class="pinned-bar">
          <div class="pinned-content">
            <span class="pinned-tag">📌 Ghim:</span>
            <span class="pinned-text">
              Nếu Scan TRAY ID hoặc cột TRAYID phần NEW không bị null thì run query này khi save...
            </span>
          </div>
          <button class="btn-close-pin" @click="showPinned = false">✖</button>
        </div>

        <!-- Danh sách tin nhắn -->
        <div ref="msgContainerRef" class="chat-messages">
          <div
            v-for="msg in currentRoom.messages"
            :key="msg.id"
            class="msg-bubble-wrap"
            :class="msg.sender === 'me' ? 'mine' : 'theirs'"
          >
            <span class="msg-sender">{{ msg.senderName }}</span>
            <div class="msg-bubble">
              {{ msg.text }}
            </div>
            <div class="msg-meta">
              <span>{{ msg.time }}</span>
              <span
                class="read-tag"
                title="Xem ai đã đọc"
                @click="openReadIdModal(msg)"
              >
                {{ msg.readStatus }}
              </span>
            </div>
          </div>
        </div>

        <!-- Hộp soạn thảo tin nhắn -->
        <div class="chat-input-bar">
          <button class="btn-action" title="Đính kèm tệp">📎</button>
          <input
            v-model="inputText"
            type="text"
            placeholder="Nhập tin nhắn..."
            @keyup.enter="sendMessage"
          />
          <button class="btn-send" @click="sendMessage">Gửi ➤</button>
        </div>
      </div>
    </div>

    <!-- ==================== MODAL: ADD MEMBER (THEO APP3.WEBP) ==================== -->
    <div v-if="showMemberModal" class="modal-overlay" @click.self="showMemberModal = false">
      <div class="modal-card">
        <div class="modal-head">
          <span>ADD MEMBER (THÊM / QUẢN LÝ THÀNH VIÊN)</span>
          <button class="btn-close" @click="showMemberModal = false">✖</button>
        </div>

        <div class="modal-body">
          <!-- Đổi tên nhóm (TITLE) -->
          <label class="form-label">
            TITLE (TÊN NHÓM - CHỈ ADMIN ĐƯỢC ĐỔI, TỐI ĐA 100 KÝ TỰ):
          </label>
          <input
            v-model="editGroupTitle"
            type="text"
            maxlength="100"
            class="form-input"
            @input="checkTitleChange"
          />

          <!-- Tìm kiếm nhân viên -->
          <label class="form-label">TÌM KIẾM NHÂN VIÊN ĐỂ THÊM:</label>
          <div class="search-add-row">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Nhập tên hoặc số máy lẻ..."
              class="form-input"
              @keyup.enter="searchAndAdd"
            />
            <button class="btn-action-add" @click="searchAndAdd">+</button>
          </div>

          <!-- Danh sách thành viên hiện tại -->
          <label class="form-label">DANH SÁCH THÀNH VIÊN HIỆN TẠI (RECENT):</label>
          <div class="member-list-box">
            <div
              v-for="m in currentRoomMembers"
              :key="m.id"
              class="member-row"
            >
              <div class="member-info">
                <strong>{{ m.name }}</strong>
                <small>{{ m.dept }} • Máy lẻ: {{ m.ext }}</small>
              </div>

              <!-- Ràng buộc Admin & Xóa theo app3.webp -->
              <span v-if="m.isAdmin" class="admin-badge">👑 Admin</span>
              <button
                v-else-if="currentRoomMembers.length >= 3"
                class="btn-remove-member"
                title="Xóa thành viên này"
                @click="removeMember(m)"
              >
                ✖ Xóa
              </button>
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn-secondary" @click="showMemberModal = false">Đóng</button>
          <button
            class="btn-primary"
            :disabled="!isTitleChanged"
            @click="saveGroupTitle"
          >
            OK (Lưu thay đổi)
          </button>
        </div>
      </div>
    </div>

    <!-- ==================== MODAL: READ ID POPUP (THEO APP2.WEBP) ==================== -->
    <div v-if="showReadModal" class="modal-overlay" @click.self="showReadModal = false">
      <div class="modal-card modal-sm">
        <div class="modal-head">
          <span>DANH SÁCH ĐÃ ĐỌC (READ ID)</span>
          <button class="btn-close" @click="showReadModal = false">✖</button>
        </div>

        <div class="modal-body">
          <p class="read-time-hint">Đã xem vào thời điểm: {{ selectedMsg?.time }}</p>
          <ul class="readers-list">
            <li v-for="name in selectedMsgReaders" :key="name">
              <span class="check-icon">✔</span>
              <strong>{{ name }}</strong>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick } from 'vue'

const showPinned = ref(true)
const showMemberModal = ref(false)
const showReadModal = ref(false)
const inputText = ref('')
const searchQuery = ref('')
const editGroupTitle = ref('')
const isTitleChanged = ref(false)
const selectedMsg = ref(null)
const msgContainerRef = ref(null)

const rooms = reactive([
  {
    id: 1,
    title: 'MOS PART (31 thành viên)',
    preview: 'Lương Đức Anh: ok anh ơi, để em ngâm cứu thử',
    time: '15:33',
    unread: 0,
    avatarBg: '#3b82f6',
    icon: '👥',
    messages: [
      {
        id: 101,
        sender: 'theirs',
        senderName: 'Lương Đức Anh (Engineer / SDV MES)',
        text: 'Các anh kiểm tra giúp em line 1002 có gọi sang được bên phân xưởng không ạ?',
        time: '15:28',
        readStatus: 'Read (12)',
        readers: ['Lê Việt Dũng', 'Nguyễn Hữu Hiếu', 'Alice Nguyễn', 'Bob Trần'],
      },
      {
        id: 102,
        sender: 'mine',
        senderName: 'Tôi (Lê Việt Dũng)',
        text: 'Anh vừa thử test gọi thoại qua WebRTC Wazo, mic và âm thanh đều thông suốt rồi nhé!',
        time: '15:30',
        readStatus: 'Read (2)',
        readers: ['Lương Đức Anh', 'Bob Trần'],
      },
      {
        id: 103,
        sender: 'theirs',
        senderName: 'Nguyễn Hữu Hiếu (Kaito)',
        text: 'Tuyệt vời, tí nữa Dũng cập nhật lại bảng danh bạ để anh em cùng dùng nhé.',
        time: '15:32',
        readStatus: 'Read (1)',
        readers: ['Lê Việt Dũng'],
      },
    ],
  },
  {
    id: 2,
    title: '[QD Project] Vận hành MFQ/MP',
    preview: 'There are new messages. (3)',
    time: '15:58',
    unread: 3,
    avatarBg: '#10b981',
    icon: '🏭',
    messages: [
      {
        id: 201,
        sender: 'theirs',
        senderName: 'Trịnh Thế Duyệt',
        text: 'Báo cáo ca làm việc hôm nay bình thường.',
        time: '15:58',
        readStatus: 'Read (5)',
        readers: ['Lê Việt Dũng'],
      },
    ],
  },
  {
    id: 3,
    title: 'Nguyễn Hữu Hiếu (Kaito)',
    preview: 'Anh test thử cuộc gọi trên máy 1002 nhé',
    time: '14:15',
    unread: 0,
    avatarBg: '#f59e0b',
    icon: 'NH',
    messages: [
      {
        id: 301,
        sender: 'theirs',
        senderName: 'Nguyễn Hữu Hiếu',
        text: 'Anh test thử cuộc gọi trên máy 1002 nhé',
        time: '14:15',
        readStatus: 'Read (1)',
        readers: ['Lê Việt Dũng'],
      },
    ],
  },
])

const currentRoom = ref(rooms[0])

const currentRoomMembers = reactive([
  { id: 1, name: 'Lê Việt Dũng', dept: 'SDV MES 1', ext: '1001', isAdmin: true },
  { id: 2, name: 'Alice Nguyễn', dept: 'SDV MES 2', ext: '1002', isAdmin: false },
  { id: 3, name: 'Bob Trần', dept: 'SDV MES 2', ext: '1003', isAdmin: false },
  { id: 4, name: 'Lương Đức Anh', dept: 'SDV MES 1', ext: '1005', isAdmin: false },
])

const selectedMsgReaders = computed(() => {
  return selectedMsg.value?.readers || ['Lê Việt Dũng']
})

const selectRoom = (room) => {
  currentRoom.value = room
  room.unread = 0
  scrollToBottom()
}

const sendMessage = () => {
  const text = inputText.value.trim()
  if (!text) return

  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  currentRoom.value.messages.push({
    id: Date.now(),
    sender: 'mine',
    senderName: 'Tôi (Lê Việt Dũng)',
    text,
    time,
    readStatus: 'Sent',
    readers: [],
  })

  currentRoom.value.preview = `Tôi: ${text}`
  currentRoom.value.time = time
  inputText.value = ''

  scrollToBottom()
}

const scrollToBottom = () => {
  nextTick(() => {
    if (msgContainerRef.value) {
      msgContainerRef.value.scrollTop = msgContainerRef.value.scrollHeight
    }
  })
}

// Modal Add Member (app3.webp logic)
const openAddMemberModal = () => {
  editGroupTitle.value = currentRoom.value.title
  isTitleChanged.value = false
  showMemberModal.value = true
}

const checkTitleChange = () => {
  isTitleChanged.value =
    editGroupTitle.value.trim() !== '' && editGroupTitle.value !== currentRoom.value.title
}

const saveGroupTitle = () => {
  currentRoom.value.title = editGroupTitle.value.trim()
  showMemberModal.value = false
}

const searchAndAdd = () => {
  const q = searchQuery.value.trim()
  if (!q) return

  if (confirm(`Thêm ID nhân viên: [${q}] vào nhóm này?`)) {
    currentRoomMembers.push({
      id: Date.now(),
      name: `Nhân viên ${q}`,
      dept: 'SDV New Member',
      ext: q,
      isAdmin: false,
    })
    searchQuery.value = ''
  }
}

const removeMember = (m) => {
  if (confirm(`Bạn có chắc chắn muốn Xóa [${m.name}] khỏi nhóm không?`)) {
    const idx = currentRoomMembers.findIndex((item) => item.id === m.id)
    if (idx !== -1) currentRoomMembers.splice(idx, 1)
  }
}

const openReadIdModal = (msg) => {
  selectedMsg.value = msg
  showReadModal.value = true
}

const startVoiceCall = () => {
  window.dispatchEvent(
    new CustomEvent('app-action', {
      detail: { type: 'dial', value: '1002' },
    }),
  )
}

const startVideoCall = () => {
  alert('Khởi tạo cuộc gọi Video WebRTC tới nhóm...')
}
</script>

<style scoped>
.messages-view {
  height: calc(100vh - 56px);
  margin: -24px;
}

.chat-container {
  display: flex;
  height: 100%;
  background: white;
}

/* Cột danh sách phòng */
.chat-rooms-col {
  width: 320px;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.rooms-header {
  padding: 16px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rooms-header h2 {
  font-size: 1.15rem;
  color: #1e293b;
  margin: 0;
}

.btn-new-room {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.room-list {
  flex: 1;
  overflow-y: auto;
}

.room-item {
  padding: 12px 16px;
  display: flex;
  gap: 12px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.15s;
}

.room-item:hover {
  background: #f8fafc;
}

.room-item.active {
  background: #e0f2fe;
  border-left: 4px solid #1e88e5;
}

.avatar-sm {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 0.95rem;
  flex-shrink: 0;
}

.room-info {
  flex: 1;
  min-width: 0;
}

.room-top {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.room-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-time {
  font-size: 0.72rem;
  color: #94a3b8;
}

.room-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.room-preview {
  font-size: 0.82rem;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge-unread {
  background: #e74c3c;
  color: white;
  font-size: 0.7rem;
  font-weight: bold;
  padding: 2px 7px;
  border-radius: 10px;
}

/* Cột khung chat chính */
.chat-main-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.chat-header {
  background: white;
  padding: 12px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-title-group h3 {
  font-size: 1.1rem;
  color: #0f172a;
  margin: 0 0 2px 0;
}

.online-indicator {
  font-size: 0.75rem;
  color: #16a34a;
}

.chat-header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.btn-action {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.btn-action:hover {
  background: #f1f5f9;
}

.btn-manage-members {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

/* Pinned Bar */
.pinned-bar {
  background: #fffbeb;
  border-bottom: 1px solid #fef3c7;
  color: #92400e;
  padding: 8px 16px;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pinned-content {
  display: flex;
  gap: 8px;
}

.pinned-tag {
  font-weight: 700;
}

.btn-close-pin {
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.6;
}

/* Messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.msg-bubble-wrap {
  display: flex;
  flex-direction: column;
  max-width: 65%;
}

.msg-bubble-wrap.mine {
  align-self: flex-end;
  align-items: flex-end;
}

.msg-bubble-wrap.theirs {
  align-self: flex-start;
  align-items: flex-start;
}

.msg-sender {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 3px;
}

.msg-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 0.9rem;
  line-height: 1.4;
}

.msg-bubble-wrap.mine .msg-bubble {
  background: #1e88e5;
  color: white;
  border-bottom-right-radius: 2px;
}

.msg-bubble-wrap.theirs .msg-bubble {
  background: white;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  border-bottom-left-radius: 2px;
}

.msg-meta {
  display: flex;
  gap: 8px;
  font-size: 0.7rem;
  color: #94a3b8;
  margin-top: 4px;
}

.read-tag {
  color: #0284c7;
  cursor: pointer;
  font-weight: 600;
}

.read-tag:hover {
  text-decoration: underline;
}

/* Input Bar */
.chat-input-bar {
  background: white;
  padding: 12px 20px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.chat-input-bar input {
  flex: 1;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 10px 16px;
  outline: none;
  font-size: 0.9rem;
}

.chat-input-bar input:focus {
  border-color: #1e88e5;
}

.btn-send {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 20px;
  font-weight: 600;
  cursor: pointer;
}

/* Modals */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: white;
  border-radius: 10px;
  width: 480px;
  max-width: 90vw;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.modal-sm {
  width: 360px;
}

.modal-head {
  padding: 14px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: #1e293b;
}

.modal-body {
  padding: 20px;
}

.modal-foot {
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.form-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #475569;
  display: block;
  margin-bottom: 4px;
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  margin-bottom: 15px;
  font-size: 0.9rem;
  outline: none;
}

.form-input:focus {
  border-color: #1e88e5;
}

.search-add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 15px;
}

.btn-action-add {
  background: #22c55e;
  color: white;
  border: none;
  width: 40px;
  height: 38px;
  border-radius: 6px;
  font-size: 1.2rem;
  cursor: pointer;
}

.member-list-box {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.member-row {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #f1f5f9;
}

.member-info strong {
  display: block;
  font-size: 0.88rem;
}

.member-info small {
  color: #64748b;
  font-size: 0.75rem;
}

.admin-badge {
  color: #3b82f6;
  font-weight: bold;
  font-size: 0.8rem;
}

.btn-remove-member {
  background: none;
  border: none;
  color: #ef4444;
  font-weight: bold;
  cursor: pointer;
}

.btn-primary {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #94a3b8;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
}

.read-time-hint {
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 12px;
}

.readers-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.readers-list li {
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  gap: 8px;
}

.check-icon {
  color: #22c55e;
}
</style>

