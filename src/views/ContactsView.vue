<template>
  <div class="contacts-container">
    <!-- Header -->
    <div class="header">
      <h1>Danh bạ liên hệ</h1>
      <div class="search-wrapper">
        <input
          v-model="searchTerm"
          @input="debounceSearch"
          placeholder="🔍 Tìm kiếm tên hoặc số máy..."
          class="search-input"
        />
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && contacts.length === 0" class="state-message">
      <div class="spinner"></div>
      <p>Đang tải danh bạ...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="state-message error">
      <p>{{ error }}</p>
      <button @click="loadContacts" class="btn-retry">Thử lại</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading && filteredContacts.length === 0" class="state-message empty">
      <p>Không tìm thấy liên hệ nào phù hợp.</p>
    </div>

    <!-- Contact List -->
    <div v-else class="contact-list">
      <div
        v-for="contact in filteredContacts"
        :key="contact.id || contact.uuid"
        class="contact-item"
      >
        <!-- Avatar với Initials -->
        <div class="avatar" :style="{ backgroundColor: getAvatarColor(contact.name) }">
          {{ getInitials(contact.name) }}
        </div>

        <!-- Thông tin -->
        <div class="contact-info">
          <div class="name">{{ contact.name || 'Ẩn danh' }}</div>
          <div class="details">
            <span class="extension">📞 {{ contact.number }}</span>
            <span v-if="contact.status" class="status-dot" :class="contact.statusClass"></span>
          </div>
        </div>

        <!-- Action Button -->
        <button @click="makeCall(contact.number)" class="btn-call" title="Gọi ngay">Gọi</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { wazoService } from '@/services/wazo'

// State
const searchTerm = ref('')
const contacts = ref([])
const loading = ref(false)
const error = ref('')

// Tính toán danh sách sau khi lọc
const filteredContacts = computed(() => {
  if (!searchTerm.value) return contacts.value

  const term = searchTerm.value.toLowerCase()
  return contacts.value.filter(
    (c) => (c.name && c.name.toLowerCase().includes(term)) || (c.number && c.number.includes(term)),
  )
})

// Lifecycle
onMounted(() => {
  loadContacts()
})

// Methods
const loadContacts = async () => {
  loading.value = true
  error.value = ''

  try {
    // 1. Lấy Source UUID của danh bạ nội bộ (Backend: wazo)
    // GET /api/dird/0.1/directories/default/sources?backend=wazo
    const token = wazoService.getToken()
    const host = wazoService.host // Ví dụ: 192.168.1.50:9443

    // Lưu ý: Cần thêm tiền tố https:// cho fetch nếu host không có
    const baseUrl = wazoService.host.startsWith('http')
      ? wazoService.host
      : `https://${wazoService.host}`

    const sourceRes = await fetch(
      `${baseUrl}/api/dird/0.1/directories/default/sources?backend=wazo`,
      {
        headers: { 'X-Auth-Token': token },
      },
    )

    if (!sourceRes.ok) throw new Error('Không thể lấy nguồn danh bạ')

    const sourcesData = await sourceRes.json()
    if (!sourcesData.items || sourcesData.items.length === 0) {
      contacts.value = []
      return
    }

    const sourceUuid = sourcesData.items[0].uuid

    // 2. Lấy Contacts từ Source đó
    // GET /api/dird/0.1/backends/wazo/sources/{uuid}/contacts
    const contactsRes = await fetch(
      `${baseUrl}/api/dird/0.1/backends/wazo/sources/${sourceUuid}/contacts?limit=1000`,
      {
        headers: { 'X-Auth-Token': token },
      },
    )

    if (!contactsRes.ok) throw new Error('Không thể tải danh sách liên hệ')

    const contactsData = await contactsRes.json()

    // Chuyển đổi dữ liệu API sang format UI đơn giản
    contacts.value = contactsData.items.map((item) => ({
      id: item.uuid,
      name: item.name,
      number: item.number, // Hoặc item.phone_number tùy schema
      status: null, // Có thể fetch presence sau này nếu cần
    }))
  } catch (err) {
    console.error('Lỗi tải danh bạ:', err)
    error.value = 'Không thể kết nối đến server Wazo để tải danh bạ.'
  } finally {
    loading.value = false
  }
}

// Debounce search để tránh gọi filter quá nhiều lần khi gõ nhanh
let debounceTimer
const debounceSearch = () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    // Logic filter đã được xử lý bởi Computed Property nên ở đây chỉ cần đảm bảo timing
  }, 300)
}

const makeCall = (extension) => {
  // Gửi sự kiện lên App.vue để mở panel gọi điện
  window.dispatchEvent(
    new CustomEvent('app-action', {
      detail: { type: 'dial', value: extension },
    }),
  )
}

// Helper functions cho UI
const getInitials = (name) => {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}

const getAvatarColor = (name) => {
  // Tạo màu ngẫu nhiên ổn định dựa trên tên
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h = Math.abs(hash % 360)
  return `hsl(${h}, 70%, 60%)`
}
</script>

<style scoped>
.contacts-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 15px;
}

.header h1 {
  color: #2c3e50;
  margin: 0;
  font-size: 1.5rem;
}

.search-wrapper {
  flex: 1;
  max-width: 400px;
}

.search-input {
  width: 100%;
  padding: 10px 15px;
  border: 1px solid #ddd;
  border-radius: 25px;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.search-input:focus {
  outline: none;
  border-color: #3498db;
  box-shadow: 0 0 5px rgba(52, 152, 219, 0.3);
}

.contact-list {
  display: grid;
  gap: 10px;
}

.contact-item {
  display: flex;
  align-items: center;
  background: white;
  padding: 12px 15px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.contact-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.avatar {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 1.1rem;
  margin-right: 15px;
  flex-shrink: 0;
}

.contact-info {
  flex: 1;
  min-width: 0; /* Cho phép text truncate */
}

.name {
  font-weight: 600;
  color: #2c3e50;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.details {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #7f8c8d;
  font-size: 0.9rem;
  margin-top: 4px;
}

.btn-call {
  background: #2ecc71;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
  margin-left: 15px;
}

.btn-call:hover {
  background: #27ae60;
}

/* States */
.state-message {
  text-align: center;
  padding: 40px 20px;
  color: #7f8c8d;
}

.state-message.error {
  color: #e74c3c;
}

.spinner {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin: 0 auto 10px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.btn-retry {
  margin-top: 10px;
  padding: 8px 15px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

/* Responsive */
@media (max-width: 600px) {
  .header {
    flex-direction: column;
    align-items: stretch;
  }

  .contact-item {
    flex-wrap: wrap;
  }

  .btn-call {
    width: 100%;
    margin-left: 0;
    margin-top: 10px;
  }
}
</style>