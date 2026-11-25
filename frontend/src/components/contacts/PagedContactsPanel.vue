<template>
  <section class="contacts-col">
    <div class="contacts-panel-card directory-panel">
      <div class="directory-toolbar">
        <div class="directory-search">
          <span class="directory-search-icon" aria-hidden="true"></span>
          <input
            v-model="term"
            type="search"
            aria-label="Tìm theo tên, máy lẻ, mã nhân viên hoặc email"
            placeholder="Tên, máy lẻ, mã nhân viên hoặc email"
            @search="clearUrlSearch"
          />
        </div>
        <button
          type="button"
          class="directory-refresh"
          aria-label="Làm mới danh bạ"
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
      <div v-if="!picker && activeTab === 'all'" class="directory-controls directory-filters">
        <label
          >Trạng thái
          <select v-model="presence">
            <option value="">Tất cả</option>
            <option value="online">Trực tuyến toàn danh bạ</option>
            <option value="offline">Ngoại tuyến toàn danh bạ</option>
          </select>
        </label>
        <button
          v-if="showRecent && recentContacts.length"
          class="directory-link"
          type="button"
          @click="emit('clear-recent')"
        >
          Xóa gần đây
        </button>
      </div>
      <div
        v-if="!picker && activeTab === 'department'"
        class="directory-controls directory-filters"
      >
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
        <p v-if="departmentNotice" role="status">{{ departmentNotice }}</p>
      </div>
      <div v-if="isGroupTab && !picker" class="directory-controls directory-filters">
        <button
          class="directory-primary"
          type="button"
          :disabled="selected.size < 2 || busy"
          @click="startGroup"
        >
          Gọi nhanh ({{ selected.size }})
        </button>
        <button v-if="selected.size" type="button" @click="clearStartedSelection">Bỏ chọn</button>
        <RouterLink v-if="groupsEnabled" class="directory-link" to="/call-groups"
          >Nhóm đã lưu</RouterLink
        >
      </div>
      <div class="directory-results" :aria-busy="paging.loading.value">
        <p v-if="refreshNotice" role="status">{{ refreshNotice }}</p>
        <p v-if="paging.notice.value && activeTab !== 'department'" role="status">
          {{ paging.notice.value }}
        </p>
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
        class="directory-controls directory-pagination"
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
const departmentNotice = ref('')
const departmentRefreshNotice = ref('')
const loadingDepartments = ref(false)
const groupsEnabled = ref(getFeatures().callGroups)
const selected = ref(new Map())
let departmentRequest
let filterTimer
let lastFilterRead = 0
const PRESENCE_FILTER_INTERVAL = 15000

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

/** Chỉ hiển thị kết quả làm mới có dữ liệu xác nhận từ backend. */
function formatRefresh(status, fetchedAt) {
  if (!fetchedAt || !['failed', 'cooldown', 'updated'].includes(status)) return ''
  const time = new Date(fetchedAt).toLocaleTimeString('vi-VN')
  if (status === 'failed') return `Chưa làm mới được. Đang dùng dữ liệu lúc ${time}.`
  if (status === 'cooldown') return `Danh bạ vừa được đọc lúc ${time}. Vui lòng chờ để tải lại.`
  return `Đã cập nhật danh bạ lúc ${time}.`
}

/** Ưu tiên trạng thái từ danh mục khi nút Làm mới được bấm trong tab bộ phận. */
const refreshNotice = computed(() =>
  activeTab.value === 'department'
    ? departmentRefreshNotice.value
    : formatRefresh(paging.refreshState.value, paging.fetchedAt.value),
)

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
async function reloadDepartments(force = false) {
  departmentRequest?.abort()
  if (!props.active || activeTab.value !== 'department' || !props.loadDepartments) return
  const request = new AbortController()
  departmentRequest = request
  loadingDepartments.value = true
  departmentError.value = ''
  departmentRefreshNotice.value = ''
  try {
    const data = await props.loadDepartments(request.signal, force === true)
    if (!request.signal.aborted) {
      departments.value = Array.isArray(data) ? data : data.items
      departmentNotice.value = data.notice || ''
      if (force === true)
        departmentRefreshNotice.value = formatRefresh(data.refresh_state, data.fetched_at)
      if (
        department.value &&
        department.value !== '__unassigned__' &&
        !departments.value.includes(department.value)
      )
        department.value = ''
      if (force === true && department.value) await paging.refresh()
    }
  } catch (error) {
    if (!request.signal.aborted) {
      if (error.status === 401 || error.status === 403) {
        departments.value = []
        department.value = ''
        departmentNotice.value = ''
      }
      departmentError.value = error.message
    }
  } finally {
    if (departmentRequest === request) loadingDepartments.value = false
  }
}
watch([activeTab, () => props.active], reloadDepartments)

/** Làm mới trang hiện tại hoặc buộc làm mới presence của nhóm gần đây. */
function refresh() {
  if (showRecent.value) syncPresence()
  else if (activeTab.value === 'department') void reloadDepartments(true)
  else void paging.refresh(true)
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
  queueFilterRefresh()
}

/** Đối soát khi bộ lọc trạng thái đang hiện, gom sự kiện và giãn lượt đọc khi nguồn lỗi. */
function queueFilterRefresh() {
  if (
    filterTimer ||
    !props.active ||
    activeTab.value !== 'all' ||
    !presence.value ||
    shortQuery.value ||
    document.visibilityState === 'hidden'
  )
    return
  const delay = paging.error.value ? 30000 : PRESENCE_FILTER_INTERVAL
  filterTimer = setTimeout(
    refreshPresenceFilter,
    Math.max(500, delay - (Date.now() - lastFilterRead)) + Math.random() * 1000,
  )
}

/** Làm mới cả tổng số và danh sách, tránh thay thế lượt tìm hoặc đổi trang đang chờ. */
async function refreshPresenceFilter() {
  filterTimer = undefined
  if (
    !props.active ||
    activeTab.value !== 'all' ||
    !presence.value ||
    shortQuery.value ||
    document.visibilityState === 'hidden'
  )
    return
  lastFilterRead = Date.now()
  if (!paging.loading.value) await paging.refresh()
  queueFilterRefresh()
}

/** Hủy timer cũ khi đổi bộ lọc, từ khóa hoặc rời màn. */
function resetFilterRefresh() {
  clearTimeout(filterTimer)
  filterTimer = undefined
  lastFilterRead = Date.now()
  queueFilterRefresh()
}
watch([activeTab, presence, term, () => props.active], resetFilterRefresh)

/** Nạp trạng thái khi trang hoặc danh sách gần đây thay đổi. */
function syncVisiblePage() {
  if (props.active) props.refreshPresence(visibleContacts.value, false)
}
watch([visibleContacts, () => props.active], syncVisiblePage, { immediate: true })

/** Theo dõi mở lại tab và thay đổi cài đặt menu. */
function listenForPresenceRefresh() {
  window.addEventListener('smartcall-directory-reconnect', syncPresence)
  window.addEventListener('wazo-presence-updated', queueFilterRefresh)
  window.addEventListener('focus', syncPresence)
  document.addEventListener('visibilitychange', syncPresence)
  window.addEventListener('smartcall-features-changed', updateFeatures)
}

/** Dọn listener và request bộ phận khi panel bị hủy. */
function stopPresenceRefresh() {
  departmentRequest?.abort()
  clearTimeout(filterTimer)
  window.removeEventListener('wazo-presence-updated', queueFilterRefresh)
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
  --directory-line: #e2e8f0;
  --directory-muted: #52647b;
  --directory-blue: #1d62b2;
  border: 1px solid var(--directory-line);
  border-radius: 12px;
  background: #fff;
  color: #1e293b;
  box-shadow: 0 2px 8px rgb(15 23 42 / 6%);
  display: flex;
  flex-direction: column;
  height: 580px;
  overflow: hidden;
}
.directory-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
  background: #f8fafc;
}
.directory-search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  min-width: 0;
  min-height: 40px;
  border: 1px solid #cbd5e1;
  border-radius: 20px;
  background: #fff;
}
.directory-search:focus-within {
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px #dbeafe;
}
.directory-search-icon {
  position: relative;
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  border: 1.6px solid #64748b;
  border-radius: 50%;
}
.directory-search-icon::after {
  position: absolute;
  inset: auto auto -2px 8px;
  width: 6px;
  height: 1.6px;
  border-radius: 1px;
  background: #64748b;
  content: '';
  transform: rotate(45deg);
  transform-origin: left;
}
.directory-search input {
  width: 100%;
  min-width: 0;
  padding: 8px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.88rem;
}
.directory-tabs {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 0 16px 12px;
  border-bottom: 1px solid var(--directory-line);
  background: #f8fafc;
}
.directory-panel button,
.directory-controls select {
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--directory-line);
  border-radius: 7px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
}
.directory-panel button {
  cursor: pointer;
}
.directory-panel button:hover:not(:disabled) {
  border-color: #a9bdd7;
  background: #f0f6fd;
}
.directory-panel button:focus-visible,
.directory-controls select:focus-visible,
.directory-link:focus-visible {
  outline: 2px solid #327fdb;
  outline-offset: 2px;
}
.directory-panel button:disabled {
  opacity: 0.5;
  cursor: default;
}
.directory-tabs button[aria-pressed='true'] {
  border-color: #93baf0;
  background: #eaf3ff;
  color: var(--directory-blue);
}
.directory-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  flex-shrink: 0;
  gap: 8px 12px;
  padding: 8px 16px;
  font-size: 0.85rem;
}
.directory-controls label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  color: var(--directory-muted);
}
.directory-controls select {
  max-width: min(280px, 55vw);
}
.directory-filters {
  border-bottom: 1px solid var(--directory-line);
}
.directory-panel .directory-refresh {
  min-height: 38px;
  white-space: nowrap;
  color: var(--directory-blue);
}
.directory-panel .directory-link,
.directory-link {
  border-color: transparent;
  color: var(--directory-blue);
  font-size: 0.82rem;
  font-weight: 600;
}
.directory-panel .directory-primary {
  border-color: #1d62b2;
  background: #1d62b2;
  color: #fff;
}
.directory-panel .directory-primary:hover:not(:disabled) {
  border-color: #184e8c;
  background: #184e8c;
}
.directory-results {
  flex: 1;
  min-height: 0;
  padding: 10px 16px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.contacts-items-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}
.directory-caption {
  margin: 0 0 8px;
  color: var(--directory-muted);
  font-size: 0.8rem;
  font-weight: 600;
}
.panel-state-message {
  margin: 0;
  padding: 28px 12px;
  color: var(--directory-muted);
  font-size: 0.88rem;
  text-align: center;
}
.directory-pagination {
  justify-content: space-between;
  border-top: 1px solid var(--directory-line);
  background: #f8fafc;
  color: var(--directory-muted);
}
@media (max-width: 540px) {
  .directory-panel {
    height: min(580px, max(420px, calc(100dvh - 155px)));
  }
  .directory-toolbar,
  .directory-tabs,
  .directory-controls,
  .directory-results {
    padding-right: 10px;
    padding-left: 10px;
  }
  .directory-toolbar {
    gap: 6px;
  }
  .directory-tabs button {
    padding: 6px 2px;
  }
}
</style>
