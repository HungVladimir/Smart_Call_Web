<template>
  <section class="contacts-col">
    <div class="contacts-panel-card directory-panel">
      <div class="panel-header directory-toolbar">
        <input
          v-model="term"
          type="search"
          class="search-input"
          aria-label="Tìm trong danh bạ"
          placeholder="Tìm tên, máy lẻ, mã nhân viên hoặc email"
          @search="clearUrlSearch"
        />
        <button
          type="button"
          class="btn-action-pill"
          :disabled="paging.loading.value"
          @click="refresh"
        >
          Làm mới
        </button>
      </div>
      <div v-if="!picker" class="directory-tabs" aria-label="Danh mục danh bạ">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :aria-pressed="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <div v-if="!picker && activeTab === 'all'" class="directory-controls">
        <label
          >Phạm vi
          <select v-model="presence">
            <option value="">Tất cả</option>
            <option value="online">Trực tuyến toàn danh bạ</option>
            <option value="offline">Ngoại tuyến toàn danh bạ</option>
          </select>
        </label>
        <button
          v-if="showRecent && recentContacts.length"
          type="button"
          @click="emit('clear-recent')"
        >
          Xóa gần đây
        </button>
      </div>
      <div v-if="!picker && activeTab === 'department'" class="directory-controls">
        <label
          >Bộ phận
          <select v-model="department" :disabled="loadingDepartments">
            <option value="">Chọn bộ phận</option>
            <option v-for="label in departments" :key="label" :value="label">{{ label }}</option>
            <option value="__unassigned__">Chưa có bộ phận</option>
          </select>
        </label>
        <p v-if="departmentError" role="alert">
          {{ departmentError }} <button type="button" @click="reloadDepartments">Thử lại</button>
        </p>
      </div>
      <div v-if="isGroupTab && !picker" class="directory-controls">
        <button type="button" :disabled="selected.size < 2 || busy" @click="startGroup">
          Gọi nhanh ({{ selected.size }})
        </button>
        <button v-if="selected.size" type="button" @click="clearStartedSelection">Bỏ chọn</button>
        <RouterLink v-if="groupsEnabled" to="/call-groups">Nhóm đã lưu</RouterLink>
      </div>
      <div class="panel-list-container directory-results">
        <p v-if="showRecent" class="directory-caption">Liên hệ gần đây</p>
        <p v-if="shortQuery" class="panel-state-message">Nhập ít nhất 2 ký tự để tìm.</p>
        <p v-else-if="waitingDepartment" class="panel-state-message">
          Chọn bộ phận để xem danh sách.
        </p>
        <p v-else-if="paging.loading.value && !visibleContacts.length" class="panel-state-message">
          Đang tải danh bạ…
        </p>
        <p v-else-if="picker && !term.trim()" class="panel-state-message">
          Tìm đồng nghiệp để thêm vào nhóm.
        </p>
        <p v-else-if="!visibleContacts.length && !paging.error.value" class="panel-state-message">
          {{ showRecent ? 'Chưa có liên hệ gần đây.' : 'Chưa có kết quả phù hợp.' }}
        </p>
        <div v-if="visibleContacts.length" class="contacts-items-list">
          <ContactCard
            v-for="contact in visibleContacts"
            :key="contact.id"
            :contact="contact"
            :group-selection-mode="isGroupTab"
            :selected="isSelected(contact)"
            :is-self="contact.number === myExtension"
            :can-invite="Boolean(contact.number && (!picker || contact.uuid))"
            :busy="busy"
            @select="toggleSelection"
            @call="emit('call', $event)"
            @remember="remember"
            @favorite="emit('favorite', $event)"
          />
        </div>
        <div v-if="paging.error.value" role="alert" class="panel-state-message">
          {{ paging.error.value }}
          <button type="button" @click="paging.retry">Thử lại</button>
        </div>
      </div>
      <nav
        v-if="!showRecent && (paging.offset.value || paging.nextOffset.value !== null)"
        class="directory-controls"
        aria-label="Trang danh bạ"
      >
        <button
          type="button"
          :disabled="paging.loading.value || !paging.offset.value"
          @click="paging.previous"
        >
          Trang trước
        </button>
        <span
          >Trang {{ Math.floor(paging.offset.value / 30) + 1
          }}<template v-if="paging.total.value">
            / {{ Math.ceil(paging.total.value / 30) }}</template
          ></span
        >
        <button
          type="button"
          :disabled="paging.loading.value || paging.nextOffset.value === null"
          @click="paging.loadMore"
        >
          Trang sau
        </button>
      </nav>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import ContactCard from './ContactCard.vue'
import { useDirectoryPages } from '@/composables/useDirectoryPages.js'
import { getFeatures } from '@/config/features.js'

const props = defineProps({
  active: Boolean,
  busy: Boolean,
  picker: Boolean,
  selectedIds: { type: Array, default: () => [] },
  myExtension: { type: String, default: '' },
  searchQuery: { type: String, default: '' },
  recentContacts: { type: Array, default: () => [] },
  loadPage: { type: Function, required: true },
  loadDepartments: { type: Function, default: null },
  refreshPresence: { type: Function, required: true },
  selectionRevision: { type: Number, default: 0 },
})
const emit = defineEmits([
  'call',
  'remember',
  'favorite',
  'start-group',
  'clear-search',
  'clear-recent',
  'toggle-member',
])
const tabs = [
  { id: 'all', label: 'Tất cả' },
  { id: 'favorites', label: 'Yêu thích' },
  { id: 'department', label: 'Bộ phận' },
  { id: 'group', label: 'Gọi nhóm' },
]
const activeTab = ref('all')
const term = ref(props.searchQuery)
const department = ref('')
const presence = ref('')
const departments = ref([])
const departmentError = ref('')
const loadingDepartments = ref(false)
const groupsEnabled = ref(getFeatures().callGroups)
const selected = ref(new Map())
let departmentRequest

/** Áp từ khóa điều hướng khi người dùng đến từ màn khác. */
function syncSearchQuery(value) {
  term.value = value
}
watch(() => props.searchQuery, syncSearchQuery)

/** Xóa lựa chọn gọi nhanh sau khi lệnh gọi đã được xác nhận. */
function clearStartedSelection() {
  selected.value.clear()
}
watch(() => props.selectionRevision, clearStartedSelection)

/** Chế độ chọn người lưu nhóm dùng tập UUID do màn nhóm quản lý. */
const isGroupTab = computed(() => props.picker || activeTab.value === 'group')
/** Tất cả khi chưa có điều kiện tra cứu chỉ lấy các liên hệ gần đây. */
const showRecent = computed(
  () => !props.picker && activeTab.value === 'all' && !term.value.trim() && !presence.value,
)
/** Hạn chế truy vấn quá rộng do vô tình nhập một ký tự. */
const shortQuery = computed(() => term.value.trim().length === 1)
/** Bộ phận chỉ nạp danh bạ sau khi đã chọn phạm vi. */
const waitingDepartment = computed(() => activeTab.value === 'department' && !department.value)

/** Tạo điều kiện tìm kiếm từ màn đang mở, hủy tự động khi rời màn. */
function getQuery() {
  if (!props.active || showRecent.value || (props.picker && !term.value.trim())) return null
  return {
    tab: activeTab.value,
    term: term.value.trim(),
    department: activeTab.value === 'department' ? department.value : '',
    presence: activeTab.value === 'all' && !props.picker ? presence.value : '',
    waitForInput: shortQuery.value || waitingDepartment.value,
  }
}

/** Gọi lệnh đọc trang do view cung cấp. */
function requestPage(query) {
  return props.loadPage(query)
}
const paging = useDirectoryPages(getQuery, requestPage)

/** Dùng tối đa một trang để tính tập presence và dựng giao diện. */
const visibleContacts = computed(() => {
  if (showRecent.value) return props.recentContacts.slice(0, 30)
  if (activeTab.value === 'favorites') return paging.contacts.value.filter(isFavorite)
  return paging.contacts.value
})

/** Không giữ lại mục yêu thích vừa bị bỏ sau khi đã nhận ACK. */
function isFavorite(contact) {
  return contact.isFavorite
}

/** Tải lại danh mục khi vào tab bộ phận và hủy khi rời màn. */
async function reloadDepartments() {
  departmentRequest?.abort()
  if (!props.active || activeTab.value !== 'department' || !props.loadDepartments) return
  const request = new AbortController()
  departmentRequest = request
  loadingDepartments.value = true
  departmentError.value = ''
  try {
    const items = await props.loadDepartments(request.signal)
    if (!request.signal.aborted) departments.value = items
  } catch (error) {
    if (!request.signal.aborted) departmentError.value = error.message
  } finally {
    if (departmentRequest === request) loadingDepartments.value = false
  }
}
watch([activeTab, () => props.active], reloadDepartments)

/** Làm mới trang hiện tại hoặc buộc làm mới presence của nhóm gần đây. */
function refresh() {
  if (showRecent.value) syncPresence()
  else if (waitingDepartment.value) void reloadDepartments()
  else paging.refresh()
}

/** Dọn query URL khi người dùng xóa từ khóa. */
function clearUrlSearch() {
  if (!term.value.trim()) emit('clear-search')
}

/** Giữ lựa chọn xuyên trang theo định danh ổn định của liên hệ. */
function isSelected(contact) {
  return props.picker
    ? props.selectedIds.includes(contact.uuid)
    : selected.value.has(contact.uuid || contact.number)
}

/** Lưu thao tác chọn thực tế, không lưu cả trang kết quả vào lịch sử. */
function remember(contact) {
  if (!props.picker && term.value.trim()) emit('remember', contact)
}

/** Gửi thao tác chọn thành viên tới view hoặc cập nhật lựa chọn gọi nhanh. */
function toggleSelection(contact) {
  if (!contact.number || contact.number === props.myExtension || (props.picker && !contact.uuid))
    return
  if (props.picker) emit('toggle-member', contact)
  else {
    const key = contact.uuid || contact.number
    if (selected.value.has(key)) selected.value.delete(key)
    else selected.value.set(key, contact)
    remember(contact)
  }
}

/** Gửi tất cả đích đã chọn, kể cả khi đang xem trang khác. */
function startGroup() {
  emit('start-group', [...selected.value.values()])
}

/** Đồng bộ đúng trang khi focus hoặc socket reconnect. */
function syncPresence(event) {
  if (props.active && document.visibilityState !== 'hidden')
    props.refreshPresence(
      visibleContacts.value,
      !event || event.type === 'smartcall-directory-reconnect',
    )
}

/** Nạp trạng thái khi trang hoặc danh sách gần đây thay đổi. */
function syncVisiblePage() {
  if (props.active) props.refreshPresence(visibleContacts.value, false)
}
watch([visibleContacts, () => props.active], syncVisiblePage, { immediate: true })

/** Theo dõi mở lại tab và thay đổi cài đặt menu. */
function listenForPresenceRefresh() {
  window.addEventListener('smartcall-directory-reconnect', syncPresence)
  window.addEventListener('focus', syncPresence)
  document.addEventListener('visibilitychange', syncPresence)
  window.addEventListener('smartcall-features-changed', updateFeatures)
}

/** Dọn listener và request bộ phận khi panel bị hủy. */
function stopPresenceRefresh() {
  departmentRequest?.abort()
  window.removeEventListener('smartcall-directory-reconnect', syncPresence)
  window.removeEventListener('focus', syncPresence)
  document.removeEventListener('visibilitychange', syncPresence)
  window.removeEventListener('smartcall-features-changed', updateFeatures)
}

/** Giữ lối vào nhóm đã lưu khớp cài đặt. */
function updateFeatures(event) {
  groupsEnabled.value = event.detail.callGroups
}

onMounted(listenForPresenceRefresh)
onUnmounted(stopPresenceRefresh)
</script>

<style scoped>
.contacts-col {
  flex: 1 1 580px;
  min-width: 0;
  width: 100%;
  max-width: 720px;
}
.directory-panel {
  border: 1px solid #dbe4ef;
  border-radius: 12px;
  background: var(--card-bg, #fff);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 580px;
}
.directory-toolbar,
.directory-tabs,
.directory-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
}
.directory-toolbar input {
  flex: 1;
  min-width: 140px;
  padding: 8px;
}
.directory-controls select {
  max-width: min(280px, 65vw);
}
.directory-results {
  padding: 0 10px 10px;
  min-height: 90px;
  overflow-y: auto;
}
.contacts-items-list {
  display: grid;
  gap: 8px;
}
.directory-controls {
  flex-shrink: 0;
}
.directory-caption {
  margin: 6px 0;
}
.directory-tabs [aria-pressed='true'] {
  font-weight: 700;
  border-color: #4463c7;
}
.directory-panel button {
  cursor: pointer;
}
.directory-panel button:disabled {
  cursor: default;
}
</style>
