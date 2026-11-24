<template>
  <section class="contacts-col">
    <div class="contacts-panel-card">
      <div class="panel-header">
        <div class="search-box">
          <span class="search-icon" aria-hidden="true">🔍</span>
          <input
            v-model="term"
            class="search-input"
            aria-label="Tìm trong danh bạ"
            placeholder="Tìm tên hoặc số máy lẻ"
          />
          <button
            v-if="term"
            class="btn-clear-search"
            aria-label="Xóa từ khóa"
            @click="clearSearch"
          >
            ✖
          </button>
        </div>
        <button
          class="btn-refresh"
          aria-label="Làm mới kết quả"
          :disabled="paging.loading.value"
          @click="refresh"
        >
          ↻
        </button>
      </div>
      <div class="panel-tabs-bar">
        <div class="panel-tabs-grid" style="grid-template-columns: repeat(5, minmax(0, 1fr))">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="panel-tab-btn"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      <div class="panel-list-container">
        <div v-if="activeTab === 'department'" class="dept-selector-bar">
          <input
            v-model="department"
            class="search-input"
            aria-label="Tên bộ phận"
            placeholder="Nhập tên bộ phận"
          />
        </div>
        <div v-if="showRecent && recentContacts.length" class="dept-selector-bar">
          <button class="btn-action-pill" @click="emit('clear-recent')">Xóa gần đây</button>
        </div>
        <div v-if="isGroupTab" class="group-call-selection-bar">
          <div class="dept-chips-scroll" aria-label="Người đã chọn">
            <button
              v-for="[number, contact] in selected"
              :key="number"
              class="btn-action-pill"
              @click="selected.delete(number)"
            >
              {{ contact.name }} ×
            </button>
          </div>
          <button class="btn-start-group" :disabled="selected.size < 2 || busy" @click="startGroup">
            Gọi nhóm ({{ selected.size }})
          </button>
        </div>
        <div v-if="shortQuery" class="panel-state-message">Nhập ít nhất 2 ký tự để tìm.</div>
        <div
          v-else-if="paging.loading.value && !visibleContacts.length"
          class="panel-state-message"
        >
          Đang tải danh bạ…
        </div>
        <div v-else-if="!visibleContacts.length && !paging.error.value" class="panel-state-message">
          {{
            showRecent
              ? 'Chưa có người gần đây. Nhập tên hoặc số máy lẻ để tìm.'
              : 'Chưa có kết quả phù hợp.'
          }}
        </div>
        <div v-if="visibleContacts.length" class="contacts-items-list">
          <ContactCard
            v-for="contact in visibleContacts"
            :key="contact.id"
            :contact="contact"
            :group-selection-mode="isGroupTab"
            :selected="selected.has(contact.number)"
            :is-self="contact.number === myExtension"
            :can-invite="Boolean(contact.number)"
            :busy="busy"
            @select="toggleSelection"
            @call="emit('call', $event)"
            @message="emit('message', $event)"
            @favorite="emit('favorite', $event)"
          />
        </div>
        <div v-if="paging.error.value" class="panel-state-message" role="alert">
          <p>{{ paging.error.value }}</p>
          <button class="btn-action-pill" @click="paging.retry">Thử lại</button>
        </div>
        <button
          v-else-if="paging.nextOffset.value !== null"
          class="btn-action-pill"
          :disabled="paging.loading.value"
          @click="paging.loadMore"
        >
          Xem thêm
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import ContactCard from './ContactCard.vue'
import { useDirectoryPages } from '@/composables/useDirectoryPages.js'

const props = defineProps({
  active: Boolean,
  busy: Boolean,
  myExtension: { type: String, default: '' },
  searchQuery: { type: String, default: '' },
  recentContacts: { type: Array, required: true },
  loadPage: { type: Function, required: true },
  refreshPresence: { type: Function, required: true },
  selectionRevision: { type: Number, default: 0 },
})
const emit = defineEmits([
  'call',
  'message',
  'favorite',
  'refresh',
  'start-group',
  'clear-search',
  'clear-recent',
])
const tabs = [
  { id: 'recent', label: 'Gần đây' },
  { id: 'all', label: 'Danh bạ' },
  { id: 'department', label: 'Bộ phận' },
  { id: 'favorites', label: 'Yêu thích' },
  { id: 'group', label: 'Gọi nhóm' },
]
const activeTab = ref('recent')
const term = ref(props.searchQuery)
const department = ref('')
const selected = ref(new Map())

/** Dùng từ khóa URL khi đi từ màn hình khác vào Calls. */
function syncSearchQuery(value) {
  term.value = value
}
watch(() => props.searchQuery, syncSearchQuery)

/** Dọn người đã chọn sau khi dịch vụ xác nhận phát cuộc gọi nhóm. */
function clearStartedSelection() {
  selected.value.clear()
}
watch(() => props.selectionRevision, clearStartedSelection)

/** Xác định thao tác quay số nhóm để giữ lựa chọn tách khỏi kết quả duyệt. */
const isGroupTab = computed(() => activeTab.value === 'group')
/** Lịch sử chỉ hiện khi người dùng chưa tìm. */
const showRecent = computed(() => activeTab.value === 'recent' && !term.value.trim())
/** Một ký tự hoặc tên bộ phận quá ngắn chưa đủ để tạo request. */
const shortQuery = computed(
  () =>
    term.value.trim().length === 1 ||
    (activeTab.value === 'department' && department.value.trim().length < 2),
)

/** Chỉ tạo truy vấn khi panel đang hoạt động, và không tải danh bạ khi ở trang Gần đây. */
function getQuery() {
  if (!props.active || showRecent.value) return null
  return {
    tab: activeTab.value,
    term: term.value.trim(),
    department: activeTab.value === 'department' ? department.value.trim() : '',
    waitForInput: shortQuery.value,
  }
}

/** Thực hiện lệnh tải trang do View cung cấp. */
function requestPage(query) {
  return props.loadPage(query)
}
const paging = useDirectoryPages(getQuery, requestPage)

/** Đọc danh sách đang xem. Mục yêu thích đã hủy phải biến mất sau ACK. */
const visibleContacts = computed(() => {
  if (showRecent.value) return props.recentContacts
  if (activeTab.value === 'favorites')
    return paging.contacts.value.filter((contact) => contact.isFavorite)
  return paging.contacts.value
})

/** Làm mới truy vấn đang xem hoặc trạng thái của người gần đây. */
function refresh() {
  if (showRecent.value) emit('refresh')
  else paging.refresh()
}

/** Xóa ô nhập và báo View dọn query từ URL. */
function clearSearch() {
  term.value = ''
  emit('clear-search')
}

/** Lưu đích đã chọn cùng UUID để View phát hiện máy lẻ đổi người dùng. */
function toggleSelection(contact) {
  if (!contact.number || contact.number === props.myExtension) return
  if (selected.value.has(contact.number)) selected.value.delete(contact.number)
  else selected.value.set(contact.number, contact)
}

/** Gửi ảnh chụp danh sách lựa chọn, kể cả người ở trang khác. */
function startGroup() {
  emit('start-group', [...selected.value.values()])
}

/** Chỉ đồng bộ trạng thái của các kết quả hiện có khi mạng kết nối lại hoặc cửa sổ được mở lại. */
function syncPresence(event) {
  if (props.active)
    props.refreshPresence(
      visibleContacts.value.slice(-30),
      event.type === 'smartcall-directory-reconnect',
    )
}
/** Theo dõi focus và reconnect trong vòng đời panel. */
function listenForPresenceRefresh() {
  window.addEventListener('smartcall-directory-reconnect', syncPresence)
  window.addEventListener('focus', syncPresence)
}
/** Gỡ listener để view đã bị hủy không tiếp tục hỏi trạng thái. */
function stopPresenceRefresh() {
  window.removeEventListener('smartcall-directory-reconnect', syncPresence)
  window.removeEventListener('focus', syncPresence)
}
onMounted(listenForPresenceRefresh)
onUnmounted(stopPresenceRefresh)
</script>
