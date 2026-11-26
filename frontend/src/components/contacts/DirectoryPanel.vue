<template>
  <section class="contacts-col">
    <div class="contacts-panel-card directory-panel">
      <div v-if="!picker" class="directory-tabs" aria-label="Danh mục danh bạ">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :aria-pressed="activeTab === tab.id"
          @click="activeTab = tab.id"
        >
          <UiIcon :name="tab.icon" class="directory-tab-icon" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
      <div v-if="activeTab === 'group'" class="directory-results">
        <slot v-if="active" name="groups" />
      </div>
      <template v-else>
        <div v-if="activeTab !== 'department' || department" class="directory-toolbar">
          <div class="directory-search">
            <UiIcon name="search-outline" />
            <input
              v-model="term"
              type="search"
              inputmode="search"
              :aria-label="searchPlaceholder"
              :placeholder="searchPlaceholder"
              @search="clearUrlSearch"
            />
          </div>
          <button
            v-if="activeTab !== 'department'"
            type="button"
            class="directory-refresh"
            aria-label="Làm mới danh bạ"
            :disabled="results.loading.value"
            @click="refresh"
          >
            <UiIcon name="refresh" />
          </button>
        </div>
        <div v-if="activeTab === 'favorites'" class="directory-controls directory-filters">
          <label
            >Trạng thái
            <select v-model="presence">
              <option value="">Tất cả yêu thích</option>
              <option value="online">Trực tuyến</option>
              <option value="offline">Ngoại tuyến</option>
            </select>
          </label>
        </div>
        <div v-if="showRecent && recentContacts.length" class="directory-controls">
          <button type="button" class="directory-link" @click="emit('clear-recent')">
            Xóa gần đây
          </button>
        </div>
        <div v-if="activeTab === 'department'" class="directory-controls directory-filters">
          <label
            >Bộ phận
            <select v-model="department" :disabled="loadingDepartments">
              <option value="">
                {{
                  departments.length || hasUnassigned ? 'Chọn bộ phận' : 'Chưa có dữ liệu bộ phận'
                }}
              </option>
              <option v-for="label in departments" :key="label" :value="label">{{ label }}</option>
              <option v-if="hasUnassigned" value="__unassigned__">Chưa có bộ phận</option>
            </select>
          </label>
          <button
            type="button"
            :disabled="loadingDepartments || results.loading.value"
            @click="refresh"
          >
            Làm mới
          </button>
          <p v-if="departmentError" role="alert">{{ departmentError }}</p>
          <p v-else-if="departmentNotice" role="status">{{ departmentNotice }}</p>
        </div>
        <div class="directory-results" :aria-busy="results.loading.value">
          <p v-if="results.notice.value && activeTab !== 'department'" role="status">
            {{ results.notice.value }}
          </p>
          <p v-if="showRecent" class="directory-caption">Liên hệ gần đây</p>
          <p v-if="queryHint" class="panel-state-message">{{ queryHint }}</p>
          <p v-else-if="picker && !term.trim()" class="panel-state-message">
            Tìm đồng nghiệp để thêm vào nhóm.
          </p>
          <p
            v-else-if="results.loading.value && !visibleContacts.length"
            class="panel-state-message"
          >
            Đang tải danh bạ…
          </p>
          <p
            v-else-if="!visibleContacts.length && !results.error.value"
            class="panel-state-message"
          >
            {{ emptyMessage }}
          </p>
          <div v-if="visibleContacts.length" class="contacts-items-list">
            <ContactCard
              v-for="contact in visibleContacts"
              :key="activeTab === 'favorites' ? contact.source + ':' + contact.id : contact.id"
              :contact="contact"
              :group-selection-mode="picker"
              :selected="selectedIds.includes(contact.uuid)"
              :is-self="Boolean(contact.number && contact.number === myExtension)"
              :can-invite="Boolean(contact.number && contact.uuid)"
              :busy="busy"
              @select="selectMember"
              @call="emit('call', $event)"
              @remember="remember"
              @favorite="emit('favorite', $event)"
            />
          </div>
          <div v-if="results.error.value" class="panel-state-message" role="alert">
            {{ results.error.value }}
            <button type="button" @click="results.refresh">Thử lại</button>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import ContactCard from './ContactCard.vue'
import UiIcon from '@/components/common/UiIcon.vue'
import { useDirectoryResults } from '@/composables/useDirectoryResults.js'
import { normalizeDirectoryText } from '@/utils/contactMapper.js'
import { directorySearchHint } from '@/utils/directorySearch.js'
import { getFeatures } from '@/config/features.js'

const props = defineProps({
  active: Boolean,
  busy: Boolean,
  picker: Boolean,
  selectedIds: { type: Array, default: () => [] },
  myExtension: { type: String, default: '' },
  searchQuery: { type: String, default: '' },
  recentContacts: { type: Array, default: () => [] },
  loadContacts: { type: Function, required: true },
  loadDepartments: { type: Function, default: null },
  refreshPresence: { type: Function, required: true },
})
const emit = defineEmits([
  'call',
  'remember',
  'favorite',
  'clear-search',
  'clear-recent',
  'toggle-member',
])
const directoryTabs = [
  { id: 'all', label: 'Tất cả', icon: 'people' },
  { id: 'favorites', label: 'Yêu thích', icon: 'star' },
  { id: 'department', label: 'Bộ phận', icon: 'office' },
  { id: 'group', label: 'Gọi nhóm', icon: 'users' },
]
const activeTab = ref('all')
const term = ref('')
const department = ref('')
const presence = ref('')
const departments = ref([])
const hasUnassigned = ref(false)
const departmentError = ref('')
const departmentNotice = ref('')
const loadingDepartments = ref(false)
const groupsEnabled = ref(getFeatures().callGroups)
let departmentRequest

/** Cờ gọi nhóm chỉ ảnh hưởng lối vào danh sách nhóm. */
const tabs = computed(() => (groupsEnabled.value ? directoryTabs : directoryTabs.slice(0, 3)))

/** Áp từ khóa từ màn hình khác vào ô tìm chung. */
function syncSearchQuery(value) {
  term.value = value
  if (!value) return
  activeTab.value = 'all'
}
watch(() => props.searchQuery, syncSearchQuery, { immediate: true })

/** Hiện lịch sử ở Tất cả khi chưa gõ, bộ chọn nhóm chỉ hiện khi tìm. */
const showRecent = computed(() => !props.picker && activeTab.value === 'all' && !term.value.trim())

/** Chờ đủ ký tự trước khi tìm trên nguồn danh bạ. Yêu thích lọc tại chỗ. */
const queryHint = computed(function getQueryHint() {
  if (activeTab.value === 'favorites' || (activeTab.value === 'department' && !department.value))
    return ''
  return directorySearchHint('', term.value.trim())
})

/** Hiện các kiểu dữ liệu người dùng có thể nhập trong cùng một ô. */
const searchPlaceholder = computed(function getSearchPlaceholder() {
  if (activeTab.value === 'favorites') return 'Tìm trong Yêu thích'
  if (activeTab.value === 'department') return 'Tìm trong bộ phận đã chọn'
  return 'Tìm tên, máy lẻ, email, mã nhân viên hoặc bộ phận'
})

/** Tạo truy vấn mới từ đầu khi đổi từ khóa. Tab bộ phận trống từ khóa vẫn xem cả bộ phận. */
function getQuery() {
  if (!props.active || activeTab.value === 'group') return null
  if (activeTab.value === 'favorites') return { tab: 'favorites' }
  const keyword = term.value.trim()
  if (activeTab.value === 'department') {
    if (!department.value || queryHint.value) return null
    if (!keyword) return { field: 'department', department: department.value }
    return { term: keyword, department: department.value }
  }
  if (!keyword || queryHint.value) return null
  return { term: keyword }
}

/** View cung cấp lệnh đọc dữ liệu phù hợp với tab. */
function load(query) {
  return props.loadContacts(query)
}
const results = useDirectoryResults(getQuery, load)

/** Lọc trạng thái từ dữ liệu đang hiển thị của Yêu thích, chưa xác minh thì không coi là ngoại tuyến. */
function matchesFavorite(contact) {
  if (!contact.isFavorite) return false
  if (
    presence.value === 'offline' &&
    contact.status !== 'offline' &&
    contact.status !== 'unavailable'
  )
    return false
  if (
    presence.value === 'online' &&
    !['online', 'busy', 'ringing', 'dnd', 'away'].includes(contact.status)
  )
    return false
  const keyword = normalizeDirectoryText(term.value).replace(/@samsung\.com$/, '')
  return (
    !keyword ||
    [contact.name, contact.number, contact.email, contact.employeeId, contact.dept].some((value) =>
      normalizeDirectoryText(value).includes(keyword),
    )
  )
}

/** Chọn đúng tập kết quả mà người dùng đang xem. */
const visibleContacts = computed(function getVisibleContacts() {
  if (showRecent.value) return props.recentContacts
  if (activeTab.value === 'favorites') return results.contacts.value.filter(matchesFavorite)
  return results.contacts.value
})

/** Phân biệt hết kết quả với lúc người dùng chưa chọn bộ phận. */
const emptyMessage = computed(function getEmptyMessage() {
  if (showRecent.value) return 'Chưa có liên hệ gần đây.'
  if (activeTab.value === 'department' && !department.value) return 'Chọn bộ phận để xem danh sách.'
  return 'Chưa có kết quả phù hợp.'
})

/** Chỉ hiện tùy chọn chưa có bộ phận khi Wazo thực sự xác nhận có bản ghi trống. */
async function reloadDepartments(force = false) {
  departmentRequest?.abort()
  if (!props.active || activeTab.value !== 'department' || !props.loadDepartments) return
  const request = new AbortController()
  departmentRequest = request
  departmentError.value = ''
  loadingDepartments.value = true
  try {
    const data = await props.loadDepartments(request.signal, force === true)
    if (request.signal.aborted) return
    departments.value = data.items
    hasUnassigned.value = data.has_unassigned === true
    departmentNotice.value = data.notice || ''
    if (
      department.value &&
      !(department.value === '__unassigned__'
        ? hasUnassigned.value
        : departments.value.includes(department.value))
    )
      department.value = ''
    if (force === true && department.value) await results.refresh()
  } catch (error) {
    if (request.signal.aborted) return
    if (error.status === 401 || error.status === 403) {
      departments.value = []
      hasUnassigned.value = false
      department.value = ''
      departmentNotice.value = ''
    }
    departmentError.value = error.message
  } finally {
    if (departmentRequest === request) loadingDepartments.value = false
  }
}
watch([activeTab, () => props.active], reloadDepartments)

/** Tải lại danh sách của tab hiện tại hoặc làm mới presence của lịch sử. */
function refresh() {
  if (activeTab.value === 'department') void reloadDepartments(true)
  else if (showRecent.value) syncPresence()
  else void results.refresh(true)
}

/** Dọn từ khóa điều hướng khi người dùng xóa ô. */
function clearUrlSearch() {
  if (!term.value.trim()) emit('clear-search')
}

/** Ghi lịch sử khi người dùng chọn một kết quả, không lưu nguyên danh sách vừa tìm. */
function remember(contact) {
  if (!props.picker && activeTab.value === 'all' && term.value.trim()) emit('remember', contact)
}

/** Chuyển UUID đã chọn sang biểu mẫu của nhóm, kể cả khi người đó đang offline. */
function selectMember(contact) {
  if (contact.uuid && contact.number && contact.number !== props.myExtension)
    emit('toggle-member', contact)
}

/** Chỉ đồng bộ tập đã tải, dùng cả các mục Yêu thích đang bị ẩn bởi bộ lọc trạng thái. */
function syncPresence(event) {
  if (!props.active || document.visibilityState === 'hidden') return
  const contacts = activeTab.value === 'favorites' ? results.contacts.value : visibleContacts.value
  if (contacts.length)
    props.refreshPresence(contacts, !event || event.type === 'smartcall-directory-reconnect')
}

/** Nạp presence khi dữ liệu đổi, tách khỏi computed lọc để sự kiện không lặp request. */
function syncLoadedContacts() {
  const contacts = showRecent.value ? props.recentContacts : results.contacts.value
  if (props.active && contacts.length) props.refreshPresence(contacts, false)
}
watch(
  [results.contacts, showRecent, () => props.active, () => props.recentContacts],
  syncLoadedContacts,
  { immediate: true },
)

/** Giữ lối vào nhóm đã lưu khớp cài đặt. */
function updateFeatures(event) {
  groupsEnabled.value = event.detail.callGroups
  if (!groupsEnabled.value && activeTab.value === 'group') activeTab.value = 'all'
}

/** Theo dõi mở lại tab, kết nối lại và thay đổi cài đặt. */
function listenForPresenceRefresh() {
  window.addEventListener('smartcall-directory-reconnect', syncPresence)
  window.addEventListener('focus', syncPresence)
  document.addEventListener('visibilitychange', syncPresence)
  window.addEventListener('smartcall-features-changed', updateFeatures)
}

/** Dọn request và listener khi rời panel. */
function stopPresenceRefresh() {
  departmentRequest?.abort()
  window.removeEventListener('smartcall-directory-reconnect', syncPresence)
  window.removeEventListener('focus', syncPresence)
  document.removeEventListener('visibilitychange', syncPresence)
  window.removeEventListener('smartcall-features-changed', updateFeatures)
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

.directory-tabs {
  padding-top: 10px;
}
.directory-tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.directory-tab-icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
}
@media (max-width: 460px) {
  .directory-tabs button {
    flex-direction: column;
    padding-inline: 3px;
  }
}
</style>
