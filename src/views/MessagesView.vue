<template>
  <div class="messages-view">
    <div class="chat-container">
      <!-- 1. CỘT DANH SÁCH PHÒNG CHAT -->
      <div class="chat-rooms-col">
        <div class="rooms-header">
          <h2>Tin nhắn</h2>
          <button class="btn-new-room" @click="openAddMemberModal">+ Tạo nhóm</button>
        </div>

        <div class="room-list">
          <div
            v-for="room in sortedRooms"
            :key="room.id"
            class="room-item"
            :class="{ active: currentRoom && currentRoom.id === room.id }"
            @click="selectRoom(room)"
          >
            <div class="avatar-sm" :style="{ backgroundColor: room.avatarBg }">
              {{ room.icon || room.title.slice(0, 2) }}
            </div>

            <div class="room-info">
              <div class="room-top">
                <span class="room-title">
                  {{ room.title }}
                  <small v-if="!room.isDirect" class="member-tag">
                    ({{ currentRoom && room.id === currentRoom.id ? currentRoomMembers.length : (room.memberCount || (room.members ? room.members.length : 3)) }})
                  </small>
                </span>
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

      <!-- 2. CỘT KHUNG CHAT CHI TIẾT -->
      <div v-if="currentRoom" class="chat-main-col">
        <!-- Chat Header -->
        <div class="chat-header">
          <div class="chat-title-group">
            <h3>{{ currentRoom.title }}</h3>
            <span class="online-indicator">
              ● Đang hoạt động ({{ currentRoom.isDirect ? 2 : currentRoomMembers.length }} thành viên)
            </span>
          </div>

          <div class="chat-header-actions">
            <button
              class="btn-action"
              :title="currentRoom.isDirect ? 'Gọi thoại 1-1 trực tiếp' : 'Khởi tạo cuộc gọi hội nghị nhóm'"
              @click="startVoiceCall"
            >
              <svg class="header-action-svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z" />
              </svg>
            </button>
            <button
              class="btn-action"
              :title="currentRoom.isDirect ? 'Gọi video 1-1' : 'Hội nghị truyền hình nhóm'"
              @click="startVideoCall"
            >
              <svg class="header-action-svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>
            <button class="btn-manage-members" @click="openAddMemberModal">👥 Thành viên</button>
          </div>
        </div>

        <!-- Thanh thông báo ghim -->
        <div v-if="showPinned" class="pinned-bar">
          <div class="pinned-content">
            <span class="pinned-tag">📌 Ghim:</span>
            <span class="pinned-text">{{ pinnedNotice }}</span>
          </div>
          <button class="btn-close-pin" title="Ẩn thông báo ghim" @click="showPinned = false">✖</button>
        </div>

        <!-- Danh sách tin nhắn -->
        <div ref="msgContainerRef" class="chat-messages">
          <div
            v-for="msg in currentRoom.messages"
            :key="msg.id"
            class="msg-bubble-wrap"
            :class="(msg.sender === 'mine' || msg.sender === 'me') ? 'mine' : 'theirs'"
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
              <button
                class="btn-pin-msg"
                title="Ghim tin nhắn này lên đầu phòng chat"
                @click="pinMessage(msg)"
              >
                📌 Ghim
              </button>
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

      <!-- Khung chờ nếu chưa chọn phòng -->
      <div v-else class="chat-main-col empty-box">
        <div class="empty-hint">
          <span class="empty-icon">💬</span>
          <p>Chọn một cuộc trò chuyện ở danh sách bên trái hoặc từ Danh bạ để bắt đầu nhắn tin.</p>
        </div>
      </div>
    </div>

    <!-- MODAL: ADD / QUẢN LÝ THÀNH VIÊN VÀ PHÂN QUYỀN ADMIN -->
    <div v-if="showMemberModal" class="modal-overlay" @click.self="showMemberModal = false">
      <div class="modal-card">
        <div class="modal-head">
          <span>QUẢN LÝ THÀNH VIÊN PHÒNG CHAT</span>
          <button class="btn-close" @click="showMemberModal = false">✖</button>
        </div>

        <div class="modal-body">
          <!-- Đổi tên nhóm (TITLE - Phân quyền Admin) -->
          <div class="admin-perm-notice" v-if="!currentIsAdmin">
            🔒 Bạn đang đăng nhập quyền Nhân viên (User thường). Chỉ Quản trị viên mới được đổi tên nhóm và xóa thành viên.
          </div>

          <label class="form-label">
            TITLE (TÊN NHÓM {{ currentIsAdmin ? '- BẠN CÓ QUYỀN SỬA' : '- KHÓA (CẦN ADMIN)' }}):
          </label>
          <input
            v-model="editGroupTitle"
            type="text"
            maxlength="100"
            class="form-input"
            :disabled="!currentIsAdmin"
            :placeholder="currentIsAdmin ? 'Nhập tên nhóm mới...' : 'Chỉ Quản trị viên mới được sửa tên nhóm'"
            @input="checkTitleChange"
          />

          <!-- Tìm kiếm nhân viên để thêm -->
          <label class="form-label">TÌM KIẾM NHÂN VIÊN ĐỂ THÊM VÀO NHÓM:</label>
          <div class="search-add-row">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Nhập tên hoặc số máy lẻ..."
              class="form-input"
              @keyup.enter="searchAndAdd"
            />
            <button class="btn-action-add" title="Thêm vào nhóm" @click="searchAndAdd">+</button>
          </div>

          <!-- Danh sách thành viên hiện tại -->
          <label class="form-label">
            DANH SÁCH THÀNH VIÊN HIỆN TẠI ({{ currentRoomMembers.length }} THÀNH VIÊN):
          </label>
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

              <!-- Ràng buộc Quyền Admin & Xóa -->
              <span v-if="m.isAdmin" class="admin-badge">👑 Admin</span>
              <button
                v-else-if="currentIsAdmin && currentRoomMembers.length >= 3"
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
            :disabled="!isTitleChanged || !currentIsAdmin"
            @click="saveGroupTitle"
          >
            OK (Lưu thay đổi)
          </button>
        </div>
      </div>
    </div>

    <!-- MODAL: DANH SÁCH NGƯỜI ĐÃ ĐỌC TIN NHẮN (READ ID) -->
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { chatService } from '@/services/chatService'
import { websocketService } from '@/services/websocketService'

const route = useRoute()

const showPinned = ref(true)
const pinnedNotice = ref('Thông báo: Mọi thắc mắc kỹ thuật vui lòng liên hệ bộ phận hỗ trợ LAN.')
const showMemberModal = ref(false)
const showReadModal = ref(false)
const inputText = ref('')
const searchQuery = ref('')
const editGroupTitle = ref('')
const isTitleChanged = ref(false)
const selectedMsg = ref(null)
const msgContainerRef = ref(null)

// Phân quyền Quản trị viên vs Người dùng thường
const currentIsAdmin = computed(() => localStorage.getItem('smartcall_is_admin') === 'true')
const currentUserName = computed(() => localStorage.getItem('smartcall_username') || 'Quản trị viên')
const currentUserExt = computed(() => localStorage.getItem('smartcall_extension') || '1001')

const rooms = ref([])
const currentRoom = ref(null)

const sortedRooms = computed(() => {
  return [...rooms.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
})

const currentRoomMembers = computed(() => {
  return currentRoom.value?.members || []
})

const selectedMsgReaders = computed(() => {
  return selectedMsg.value?.readers || [currentUserName.value]
})

const loadRooms = async () => {
  const list = await chatService.getRooms()
  rooms.value = [...list]
  if (!currentRoom.value && rooms.value.length > 0) {
    currentRoom.value = rooms.value[0]
  }
}

const selectRoom = (room) => {
  currentRoom.value = room
  room.unread = 0
  chatService.saveRooms()
  scrollToBottom()
}

// Ghim tin nhắn bất kỳ lên đầu phòng chat
const pinMessage = async (msg) => {
  pinnedNotice.value = `${msg.senderName}: "${msg.text}"`
  showPinned.value = true
  if (currentRoom.value) {
    await chatService.updatePinnedMessage(currentRoom.value.id, pinnedNotice.value)
  }
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: {
        message: `📌 Đã ghim tin nhắn của [${msg.senderName}] lên đầu phòng chat!`,
        type: 'success',
      },
    }),
  )
}

const sendMessage = async () => {
  const text = inputText.value.trim()
  if (!text || !currentRoom.value) return

  const targetId = currentRoom.value.id
  inputText.value = ''

  // Cập nhật ngay tức thì trên mảng rooms để giao diện nhảy Top 1 lập tức
  const target = rooms.value.find((r) => r.id === targetId)
  if (target) {
    target.updatedAt = Date.now()
    target.preview = text
    target.time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  }
  rooms.value = [...rooms.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

  // Lưu bền vững vào cơ sở dữ liệu chatService
  await chatService.sendMessage(targetId, text, currentUserName.value)
  const freshRooms = await chatService.getRooms()
  rooms.value = [...freshRooms]
  const updated = rooms.value.find((r) => r.id === targetId)
  if (updated) currentRoom.value = updated
  scrollToBottom()
}

const scrollToBottom = () => {
  nextTick(() => {
    if (msgContainerRef.value) {
      msgContainerRef.value.scrollTop = msgContainerRef.value.scrollHeight
    }
  })
}

// Xử lý mở hội thoại 1-1 trực tiếp khi người dùng chuyển từ Danh bạ sang
const checkDirectChatRoute = async () => {
  if (route.query && route.query.ext) {
    const ext = String(route.query.ext)
    const name = route.query.name ? String(route.query.name) : `Máy lẻ ${ext}`

    const directRoom = await chatService.getDirectRoom(ext, name, currentUserName.value)
    const fresh = await chatService.getRooms()
    rooms.value = [...fresh]
    currentRoom.value = directRoom
    scrollToBottom()
  }
}

watch(
  () => route.query,
  () => {
    checkDirectChatRoute()
  },
  { immediate: true },
)

// Lắng nghe tin nhắn mới từ WebSocket
const handleRealtimeMessage = (data) => {
  if (!data) return
  const targetRoom = rooms.value.find((r) => r.id === data.room_uuid)
  if (targetRoom) {
    if (!targetRoom.messages) targetRoom.messages = []
    targetRoom.messages.push({
      id: data.uuid || `msg-${Date.now()}`,
      sender: 'theirs',
      senderName: data.alias || 'Đồng nghiệp',
      text: data.content,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      readStatus: 'Read',
      readers: [],
    })
    targetRoom.preview = data.content
    targetRoom.updatedAt = Date.now()
    rooms.value = [...rooms.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    chatService.saveRooms()
    chatService.getRooms().then((res) => {
      rooms.value = [...res]
    })
    if (currentRoom.value && currentRoom.value.id === targetRoom.id) {
      scrollToBottom()
    } else {
      targetRoom.unread = (targetRoom.unread || 0) + 1
    }
  }
}

onMounted(async () => {
  await loadRooms()
  await checkDirectChatRoute()
  websocketService.connect()
  websocketService.on('chatd_user_room_message_created', handleRealtimeMessage)
})

onUnmounted(() => {
  websocketService.off('chatd_user_room_message_created', handleRealtimeMessage)
})

// Modal Quản lý thành viên
const openAddMemberModal = () => {
  if (!currentRoom.value) return
  editGroupTitle.value = currentRoom.value.title
  isTitleChanged.value = false
  showMemberModal.value = true
}

const checkTitleChange = () => {
  if (!currentRoom.value) return
  isTitleChanged.value =
    editGroupTitle.value.trim() !== '' && editGroupTitle.value !== currentRoom.value.title
}

const saveGroupTitle = async () => {
  if (!currentIsAdmin.value || !currentRoom.value) return
  try {
    await chatService.updateRoomTitle(currentRoom.value.id, editGroupTitle.value)
    currentRoom.value.title = editGroupTitle.value.trim()
    rooms.value = await chatService.getRooms()
    showMemberModal.value = false
  } catch (err) {
    alert(err.message)
  }
}

const searchAndAdd = async () => {
  const q = searchQuery.value.trim()
  if (!q || !currentRoom.value) return

  if (confirm(`Thêm nhân viên có số máy lẻ [${q}] vào nhóm này?`)) {
    const newEmp = {
      id: `emp-${q}-${Date.now()}`,
      name: `Nhân viên ${q}`,
      dept: 'Khối Kỹ thuật',
      ext: q,
      isAdmin: false,
    }
    await chatService.addMember(currentRoom.value.id, newEmp)
    rooms.value = await chatService.getRooms()
    const updated = rooms.value.find((r) => r.id === currentRoom.value.id)
    if (updated) currentRoom.value = updated
    searchQuery.value = ''
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `Đã thêm thành viên máy lẻ ${q} vào nhóm thành công!`, type: 'success' },
      }),
    )
  }
}

const removeMember = async (m) => {
  if (!currentIsAdmin.value || !currentRoom.value) return
  if (confirm(`Bạn có chắc chắn muốn Xóa [${m.name}] khỏi nhóm không?`)) {
    try {
      await chatService.removeMember(currentRoom.value.id, m.id)
      rooms.value = await chatService.getRooms()
      const updated = rooms.value.find((r) => r.id === currentRoom.value.id)
      if (updated) currentRoom.value = updated
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: `Đã xóa [${m.name}] khỏi nhóm!`, type: 'info' },
        }),
      )
    } catch (err) {
      alert(err.message)
    }
  }
}

const openReadIdModal = (msg) => {
  selectedMsg.value = msg
  showReadModal.value = true
}

const startVoiceCall = () => {
  if (!currentRoom.value) return
  if (currentRoom.value.isDirect) {
    const targetExt = currentRoom.value.ext || '1002'
    window.dispatchEvent(
      new CustomEvent('app-action', {
        detail: { type: 'dial', value: targetExt },
      }),
    )
  } else {
    const confRoomNumber = '8001'
    const memberCount = currentRoomMembers.value.length || 3
    if (
      confirm(
        `Khởi tạo cuộc gọi hội nghị cho nhóm [${currentRoom.value.title}] (${memberCount} thành viên)?\n\nHệ thống sẽ kết nối bạn vào phòng hội nghị nội bộ số máy ${confRoomNumber} và gửi thông báo mời các thành viên tham gia.`
      )
    ) {
      chatService.sendMessage(
        currentRoom.value.id,
        `🔔 [${currentUserName.value}] đã bắt đầu cuộc gọi hội nghị thoại nhóm (Số phòng họp: ${confRoomNumber}). Mọi người vui lòng nhấn nút Gọi để cùng tham gia!`,
        'Hệ thống Tổng đài'
      )
      const target = rooms.value.find((r) => r.id === currentRoom.value.id)
      if (target) {
        target.updatedAt = Date.now()
      }
      rooms.value = [...rooms.value].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      chatService.getRooms().then((res) => {
        rooms.value = [...res]
        const updated = rooms.value.find((r) => r.id === currentRoom.value.id)
        if (updated) currentRoom.value = updated
        scrollToBottom()
      })
      window.dispatchEvent(
        new CustomEvent('app-action', {
          detail: { type: 'dial', value: confRoomNumber },
        }),
      )
    }
  }
}

const startVideoCall = () => {
  if (!currentRoom.value) return
  if (currentRoom.value.isDirect) {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `Khởi tạo cuộc gọi Video 1-1 tới máy lẻ ${currentRoom.value.ext || '1002'}...`,
          type: 'info',
        },
      }),
    )
    window.dispatchEvent(
      new CustomEvent('app-action', {
        detail: { type: 'dial', value: currentRoom.value.ext || '1002' },
      }),
    )
  } else {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message:
            'Tính năng Video nhóm yêu cầu máy chủ Media SFU (Janus/Jitsi Gateway). Hiện tại hệ thống hỗ trợ họp thoại nhóm qua phòng hội nghị 8001.',
          type: 'warning',
        },
      }),
    )
  }
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

.member-tag {
  color: #64748b;
  font-weight: normal;
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

.empty-box {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-hint {
  text-align: center;
  color: #94a3b8;
  max-width: 320px;
}

.empty-icon {
  font-size: 3rem;
  display: block;
  margin-bottom: 12px;
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

.header-action-svg {
  width: 16px;
  height: 16px;
  fill: #475569;
  transition: fill 0.15s;
}

.btn-action:hover .header-action-svg {
  fill: #1e88e5;
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
  font-size: 0.9rem;
}

.btn-close-pin:hover {
  opacity: 1;
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
  background: #0284c7;
  color: white;
  border-bottom-right-radius: 2px;
  box-shadow: 0 1px 4px rgba(2, 132, 199, 0.3);
}

.msg-bubble-wrap.mine .msg-sender {
  color: #0284c7;
  font-weight: 600;
}

.msg-bubble-wrap.theirs .msg-bubble {
  background: white;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  border-bottom-left-radius: 2px;
}

.msg-meta {
  display: flex;
  align-items: center;
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

.btn-pin-msg {
  background: none;
  border: none;
  color: #b45309;
  cursor: pointer;
  font-size: 0.7rem;
  padding: 0 2px;
  border-radius: 2px;
}

.btn-pin-msg:hover {
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
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: white;
  border-radius: 10px;
  width: 480px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.modal-sm {
  width: 380px;
}

.modal-head {
  padding: 16px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: #1e293b;
  font-size: 0.95rem;
}

.btn-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
}

.modal-body {
  padding: 20px;
}

.admin-perm-notice {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.78rem;
  margin-bottom: 14px;
  line-height: 1.4;
}

.form-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px;
  margin-top: 12px;
}

.form-label:first-of-type {
  margin-top: 0;
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
}

.form-input:disabled {
  background: #f1f5f9;
  cursor: not-allowed;
  color: #94a3b8;
}

.search-add-row {
  display: flex;
  gap: 8px;
}

.btn-action-add {
  background: #1e88e5;
  color: white;
  border: none;
  width: 38px;
  border-radius: 6px;
  font-size: 1.2rem;
  cursor: pointer;
  flex-shrink: 0;
}

.member-list-box {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin-top: 6px;
}

.member-row {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.member-info {
  display: flex;
  flex-direction: column;
}

.member-info strong {
  font-size: 0.88rem;
  color: #1e293b;
}

.member-info small {
  font-size: 0.75rem;
  color: #64748b;
}

.admin-badge {
  background: #fef3c7;
  color: #b45309;
  font-size: 0.72rem;
  padding: 3px 8px;
  border-radius: 12px;
  font-weight: 700;
}

.btn-remove-member {
  background: #fee2e2;
  color: #ef4444;
  border: 1px solid #fecaca;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  cursor: pointer;
  font-weight: 600;
}

.btn-remove-member:hover {
  background: #ef4444;
  color: white;
}

.modal-foot {
  padding: 12px 20px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-secondary {
  background: #e2e8f0;
  color: #475569;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
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

.btn-primary:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

.read-time-hint {
  font-size: 0.8rem;
  color: #64748b;
  margin-bottom: 12px;
}

.readers-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
}

.readers-list li {
  padding: 8px 0;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  color: #1e293b;
}

.check-icon {
  color: #16a34a;
  font-weight: bold;
}
</style>
