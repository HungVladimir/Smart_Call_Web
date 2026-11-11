<template>
  <div class="contacts-container">
    <!-- Header Toolbar -->
    <div class="contacts-header">
      <div class="header-left">
        <h1>Danh bạ nhân viên</h1>
        <span class="sub-title">Danh sách máy lẻ nội bộ SDV LAN Directory</span>
      </div>

      <div class="header-actions">
        <!-- Search Input -->
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="searchTerm"
            placeholder="Tìm kiếm theo tên, phòng ban hoặc số máy..."
            class="search-input"
          />
          <button v-if="searchTerm" class="btn-clear-search" @click="searchTerm = ''">✖</button>
        </div>

        <button class="btn-add-contact" @click="showAddModal = true">+ Thêm liên hệ</button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải danh bạ nhân viên...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredContacts.length === 0" class="state-message empty">
      <p>Không tìm thấy nhân viên nào phù hợp với từ khóa "{{ searchTerm }}".</p>
    </div>

    <!-- Contact Table (Chuẩn Desktop UI) -->
    <div v-else class="table-card">
      <table class="contact-table">
        <thead>
          <tr>
            <th>Nhân viên</th>
            <th>Bộ phận / Phòng ban</th>
            <th>Số máy lẻ</th>
            <th>Trạng thái</th>
            <th style="text-align: right; width: 180px;">4 Nút Chức Năng (App4)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contact in filteredContacts" :key="contact.id">
            <!-- 1. Tên & Avatar -->
            <td>
              <div class="contact-user-cell">
                <div class="avatar-circle" :style="{ backgroundColor: getAvatarColor(contact.name) }">
                  {{ getInitials(contact.name) }}
                </div>
                <div class="user-meta">
                  <strong class="user-hname">{{ contact.name }}</strong>
                  <span class="user-email">{{ contact.email || 'Nội bộ SDV' }}</span>
                </div>
              </div>
            </td>

            <!-- 2. Phòng ban (DEPTNAME) -->
            <td>
              <span class="dept-badge">{{ contact.dept || 'SDV MES Group' }}</span>
            </td>

            <!-- 3. Số máy lẻ -->
            <td>
              <span class="ext-tag">📞 {{ contact.number }}</span>
            </td>

            <!-- 4. Trạng thái Online/Offline -->
            <td>
              <div class="status-cell">
                <span
                  class="status-dot"
                  :class="contact.status === 'online' ? 'status-online' : 'status-offline'"
                ></span>
                <span class="status-label" :class="{ online: contact.status === 'online' }">
                  {{ contact.status === 'online' ? 'Online' : 'Offline' }}
                </span>
              </div>
            </td>

            <!-- 5. BỐN NÚT CHỨC NĂNG CHUẨN THEO ẢNH APP4.WEBP -->
            <td style="text-align: right;">
              <div class="action-buttons-group">
                <!-- Nút 1: Gọi thoại -->
                <button
                  class="btn-icon btn-call"
                  title="1. Gọi thoại (Voice Call)"
                  @click="handleCall(contact.number)"
                >
                  📞
                </button>

                <!-- Nút 2: Nhắn tin (kèm Badge tin chưa đọc NOT_READ) -->
                <button
                  class="btn-icon btn-msg"
                  title="2. Nhắn tin (Chat)"
                  @click="handleMessage(contact)"
                >
                  💬
                  <span v-if="contact.unreadCount > 0" class="badge-unread">
                    {{ contact.unreadCount }}
                  </span>
                </button>

                <!-- Nút 3: Gọi Video -->
                <button
                  class="btn-icon btn-video"
                  title="3. Gọi Video (Video Call)"
                  @click="handleVideoCall(contact)"
                >
                  🎥
                </button>

                <!-- Nút 4: Xóa liên hệ (có popup hỏi xóa) -->
                <button
                  class="btn-icon btn-delete"
                  title="4. Xóa khỏi liên hệ gần đây"
                  @click="handleDelete(contact)"
                >
                  ❌
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Thêm Liên Hệ Mới -->
    <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
      <div class="modal-card">
        <div class="modal-head">
          <span>THÊM LIÊN HỆ MỚI VÀO DANH BẠ</span>
          <button class="btn-close" @click="showAddModal = false">✖</button>
        </div>

        <form @submit.prevent="saveNewContact" class="modal-body">
          <div class="form-group">
            <label>Họ và tên nhân viên *</label>
            <input v-model="newContact.name" placeholder="VD: Nguyễn Văn A" required class="form-input" />
          </div>

          <div class="form-group">
            <label>Số máy lẻ (Extension) *</label>
            <input v-model="newContact.number" placeholder="VD: 1008" required maxlength="6" class="form-input" />
          </div>

          <div class="form-group">
            <label>Bộ phận / Phòng ban</label>
            <input v-model="newContact.dept" placeholder="VD: SDV MES 2 / Vận hành" class="form-input" />
          </div>

          <div class="form-group">
            <label>Email liên hệ</label>
            <input v-model="newContact.email" type="email" placeholder="VD: a.nguyen@company.local" class="form-input" />
          </div>

          <div class="modal-foot">
            <button type="button" class="btn-cancel" @click="showAddModal = false">Hủy</button>
            <button type="submit" class="btn-submit">Lưu liên hệ</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { contactService } from '@/services/contactService'

const router = useRouter()

const searchTerm = ref('')
const contacts = ref([])
const loading = ref(false)
const showAddModal = ref(false)

const newContact = ref({
  name: '',
  number: '',
  dept: '',
  email: '',
})

onMounted(() => {
  loadContacts()
})

const loadContacts = async () => {
  loading.value = true
  try {
    contacts.value = await contactService.getContacts()
  } finally {
    loading.value = false
  }
}

// Lọc danh bạ theo từ khóa tìm kiếm
const filteredContacts = computed(() => {
  if (!searchTerm.value.trim()) return contacts.value
  const q = searchTerm.value.toLowerCase().trim()
  return contacts.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.dept && c.dept.toLowerCase().includes(q)) ||
      (c.number && c.number.includes(q)),
  )
})

// --- XỬ LÝ 4 NÚT HÀNH ĐỘNG (APP4.WEBP) ---

// 1. Gọi thoại
const handleCall = (extension) => {
  if (!extension) return
  // Phát event cuộc gọi lên App.vue
  window.dispatchEvent(
    new CustomEvent('app-action', {
      detail: { type: 'dial', value: extension },
    }),
  )
  // Chuyển sang màn hình bàn phím cuộc gọi
  router.push('/calls')
}

// 2. Nhắn tin (Chat)
const handleMessage = (contact) => {
  // Đánh dấu đã đọc
  contact.unreadCount = 0
  // Chuyển sang màn hình Tin nhắn
  router.push('/messages')
}

// 3. Gọi Video
const handleVideoCall = (contact) => {
  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `🎥 Đang khởi tạo cuộc gọi Video WebRTC tới ${contact.name} (${contact.number})...` },
    }),
  )
}

// 4. Xóa liên hệ (Xóa khỏi Recent có hỏi xác nhận)
const handleDelete = async (contact) => {
  const isConfirmed = confirm(`Hỏi xóa liên hệ: Bạn có chắc chắn muốn xóa [${contact.name}] khỏi danh bạ không?`)
  if (isConfirmed) {
    await contactService.deleteContact(contact.id)
    contacts.value = contacts.value.filter((c) => c.id !== contact.id)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `Đã xóa liên hệ [${contact.name}] khỏi danh bạ!` },
      }),
    )
  }
}

// Thêm liên hệ mới
const saveNewContact = async () => {
  if (!newContact.value.name || !newContact.value.number) return

  await contactService.addContact({ ...newContact.value })
  contacts.value = await contactService.getContacts()
  showAddModal.value = false

  window.dispatchEvent(
    new CustomEvent('app-toast', {
      detail: { message: `Đã thêm liên hệ [${newContact.value.name}] thành công!`, type: 'success' },
    }),
  )

  newContact.value = { name: '', number: '', dept: '', email: '' }
}

// Helper Avatar
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(-2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 65%, 48%)`
}
</script>

<style scoped>
.contacts-container {
  max-width: 1100px;
  margin: 0 auto;
}

/* Header Toolbar */
.contacts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.header-left h1 {
  font-size: 1.5rem;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.sub-title {
  font-size: 0.85rem;
  color: #64748b;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-box {
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  padding: 6px 14px;
  width: 320px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.search-icon {
  font-size: 0.9rem;
  margin-right: 6px;
}

.search-input {
  border: none;
  outline: none;
  font-size: 0.9rem;
  width: 100%;
}

.btn-clear-search {
  background: none;
  border: none;
  cursor: pointer;
  color: #94a3b8;
  font-size: 0.8rem;
}

.btn-add-contact {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 20px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(30, 136, 229, 0.3);
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-add-contact:hover {
  background: #1565c0;
}

/* Table Card */
.table-card {
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}

.contact-table {
  width: 100%;
  border-collapse: collapse;
}

.contact-table th {
  background: #f8fafc;
  padding: 14px 18px;
  text-align: left;
  font-size: 0.82rem;
  text-transform: uppercase;
  color: #64748b;
  font-weight: 600;
  border-bottom: 1px solid #e2e8f0;
}

.contact-table td {
  padding: 14px 18px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.contact-table tr:hover {
  background: #f8fafc;
}

/* User Meta Cell */
.contact-user-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar-circle {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: white;
  font-weight: bold;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user-meta {
  display: flex;
  flex-direction: column;
}

.user-hname {
  color: #1e293b;
  font-size: 0.92rem;
}

.user-email {
  color: #94a3b8;
  font-size: 0.75rem;
}

/* Dept Badge */
.dept-badge {
  background: #f1f5f9;
  color: #475569;
  font-size: 0.82rem;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

/* Extension Tag */
.ext-tag {
  font-family: monospace;
  font-size: 0.88rem;
  color: #1e88e5;
  font-weight: 600;
  background: #e0f2fe;
  padding: 3px 8px;
  border-radius: 4px;
}

/* Status Dot */
.status-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.status-online {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}

.status-offline {
  background: #94a3b8;
}

.status-label {
  font-size: 0.82rem;
  color: #64748b;
}

.status-label.online {
  color: #16a34a;
  font-weight: 600;
}

/* 4 Action Buttons Group (Theo app4.webp) */
.action-buttons-group {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-icon {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  position: relative;
  transition: all 0.2s;
}

.btn-icon:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}

.btn-call:hover {
  background: #dcfce7;
  border-color: #22c55e;
  color: #15803d;
}

.btn-msg:hover {
  background: #e0f2fe;
  border-color: #0284c7;
  color: #0369a1;
}

.btn-video:hover {
  background: #f3e8ff;
  border-color: #9333ea;
  color: #7e22ce;
}

.btn-delete:hover {
  background: #fee2e2;
  border-color: #ef4444;
  color: #b91c1c;
}

.badge-unread {
  position: absolute;
  top: -6px;
  right: -6px;
  background: #ef4444;
  color: white;
  font-size: 0.65rem;
  font-weight: bold;
  padding: 1px 5px;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Modal Form */
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
  width: 440px;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
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

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #475569;
  margin-bottom: 5px;
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 0.9rem;
  outline: none;
}

.form-input:focus {
  border-color: #1e88e5;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.btn-cancel {
  background: #e2e8f0;
  color: #475569;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-submit {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 8px 18px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

/* State Message */
.state-message {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
  background: white;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}

.spinner {
  border: 3px solid #f3f3f3;
  border-top: 3px solid #1e88e5;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  animation: spin 1s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
