<template>
  <div v-if="isOpen" class="add-participant-overlay" @click.self="closeAddParticipantModal">
    <div class="add-participant-card">
      <div class="add-participant-header">
        <div class="add-participant-title">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="#2563eb"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="8.5" cy="7" r="4"></circle>
            <line x1="20" y1="8" x2="20" y2="14"></line>
            <line x1="23" y1="11" x2="17" y2="11"></line>
          </svg>
          <span>Thêm người vào cuộc gọi</span>
        </div>
        <button class="btn-close-modal" @click="closeAddParticipantModal" title="Đóng">✕</button>
      </div>

      <div class="add-participant-search">
        <input
          v-model="addParticipantSearch"
          type="text"
          placeholder="Tìm theo tên, số máy lẻ..."
          class="add-search-input"
        />
      </div>

      <div
        v-if="loadPage && selectedContacts.size"
        class="add-participant-search"
        aria-label="Người đã chọn"
      >
        <button
          v-for="[identity, contact] in selectedContacts"
          :key="identity"
          type="button"
          @click="toggleContact(contact)"
        >
          {{ contact.name }} ×
        </button>
      </div>
      <div class="add-participant-list">
        <div
          v-if="paging.loading.value && !availableAddParticipants.length"
          class="add-participant-empty"
        >
          <p>Đang tìm đồng nghiệp…</p>
        </div>
        <div v-else-if="paging.error.value" class="add-participant-empty" role="alert">
          <p>{{ paging.error.value }}</p>
          <button type="button" @click="paging.retry">Thử lại</button>
        </div>
        <div
          v-else-if="loadPage && addParticipantSearch.trim().length === 1"
          class="add-participant-empty"
        >
          <p>Nhập ít nhất 2 ký tự để tìm.</p>
        </div>
        <div v-else-if="availableAddParticipants.length === 0" class="add-participant-empty">
          <p>Không có đồng nghiệp trực tuyến nào khả dụng để mời.</p>
        </div>
        <div
          v-for="c in availableAddParticipants"
          :key="c.uuid || c.number"
          class="add-participant-item"
          :class="{ selected: isSelected(c) }"
          @click="toggleContact(c)"
        >
          <div class="add-item-checkbox">
            <input
              type="checkbox"
              :checked="isSelected(c)"
              :disabled="!canToggleContact(c)"
              @click.stop="toggleContact(c)"
            />
          </div>
          <div class="add-item-avatar" :style="{ backgroundColor: getAvatarColor(c.name) }">
            {{ getInitials(c.name) }}
          </div>
          <div class="add-item-info">
            <div class="add-item-name">{{ c.name }}</div>
            <div class="add-item-sub">
              <span class="add-item-ext">Máy lẻ {{ c.number }}</span>
              <span v-if="c.dept" class="add-item-dept">• {{ c.dept }}</span>
            </div>
          </div>
          <ContactPresenceDot :status="c.status" />
        </div>
        <button
          v-if="paging.nextOffset.value !== null && !paging.error.value"
          type="button"
          :disabled="paging.loading.value"
          @click="paging.loadMore"
        >
          Xem thêm
        </button>
      </div>

      <div class="add-participant-footer">
        <button class="btn-add-cancel" @click="closeAddParticipantModal">Hủy</button>
        <button
          class="btn-add-confirm"
          :disabled="selectedContacts.size === 0 || submitting"
          @click="confirmAddParticipants"
        >
          Mời vào cuộc gọi ({{ selectedContacts.size }})
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { getAvatarInitials as getInitials, getAvatarColor } from '@/utils/avatar.js'
import { useDirectoryPages } from '@/composables/useDirectoryPages.js'
import ContactPresenceDot from '@/components/contacts/ContactPresenceDot.vue'

/** Chỉ giữ lựa chọn tạm khi modal mở; gửi danh sách máy lẻ đã chọn cho view xử lý. */
const props = defineProps({
  isOpen: Boolean,
  submitting: Boolean,
  contacts: { type: Array, required: true },
  call: { type: Object, default: null },
  group: { type: Object, required: true },
  myExtension: { type: String, default: '' },
  canInviteContact: { type: Function, required: true },
  loadPage: { type: Function, default: null },
  refreshPresence: { type: Function, default: null },
})
const emit = defineEmits(['close', 'confirm'])
/**
 * Đọc danh bạ hiện tại theo cơ chế phản ứng của Vue, không tạo bản sao dữ liệu riêng cho giao
 * diện.
 */
const contacts = computed(() => props.contacts)
const addParticipantSearch = ref('')

const selectedContacts = ref(new Map())

/** Chỉ tải trang trong vòng đời của modal và cuộc gọi đang mời. */
function getQuery() {
  if (!props.isOpen || !props.loadPage) return null
  const term = addParticipantSearch.value.trim()
  return { term, waitForInput: term.length === 1, callId: props.call?.callId }
}

/** Nhờ View tải trang qua ContactService. */
function requestPage(query) {
  return props.loadPage(query)
}
const paging = useDirectoryPages(getQuery, requestPage)

/** Lấy trạng thái cho đúng trang modal, không quét cả danh bạ khi người dùng mở modal. */
function refreshModalPresence(page, previousPage, onCleanup) {
  if (!props.isOpen || !props.refreshPresence || !page[0].length) return
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  props.refreshPresence(page[0], true, controller.signal)
}
watch([paging.contacts, () => props.isOpen], refreshModalPresence)

/**
 * Lọc người có thể mời: bỏ chính mình, peer/thành viên đã có và người không sẵn sàng; áp dụng từ
 * khóa tìm kiếm.
 */
const availableAddParticipants = computed(() => {
  const myExt = String(props.myExtension || '').trim()
  const activeExt = String(props.call?.number || '').trim()
  const isGroup = Boolean(props.call?.isGroupCall)
  const inCallExts = new Set(
    (props.call?.groupParticipantExtensions || props.group.groupParticipantExtensions || []).map(
      (e) => String(e).trim(),
    ),
  )
  if (!isGroup && activeExt) inCallExts.add(activeExt)
  if (myExt) inCallExts.add(myExt)

  const source = props.loadPage ? paging.contacts.value : contacts.value
  let list = source.filter((c) => {
    const ext = String(c.number || '').trim()
    return ext && (props.loadPage || props.canInviteContact(c)) && !inCallExts.has(ext)
  })

  const q = addParticipantSearch.value.trim().toLowerCase()
  if (q && !props.loadPage) {
    list = list.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.number || '').includes(q) ||
        (c.dept || '').toLowerCase().includes(q),
    )
  }
  return list
})

/** Dùng UUID làm khóa để người mới dùng cùng một số không thừa hưởng lựa chọn cũ. */
function identityOf(contact) {
  return contact.uuid || String(contact.number).trim()
}

/** Kiểm tra đúng liên hệ đã chọn, kể cả khi ở trang khác. */
function isSelected(contact) {
  return selectedContacts.value.has(identityOf(contact))
}

/** Giữ ảnh chụp UUID và số của người đã chọn độc lập với trang đang xem. */
function toggleContact(contact) {
  if (!canToggleContact(contact)) return
  const identity = identityOf(contact)
  if (isSelected(contact)) selectedContacts.value.delete(identity)
  else selectedContacts.value.set(identity, { ...contact })
}

/** Khóa thêm đích không khả dụng nhưng vẫn cho bỏ chọn khi trạng thái vừa thay đổi. */
function canToggleContact(contact) {
  return isSelected(contact) || props.canInviteContact(contact)
}
// Đồng bộ vòng đời mở/đóng modal: reset lựa chọn tạm hoặc dọn tài nguyên không còn dùng.
/** Xóa bộ chọn khi modal đóng/mở hoặc cuộc gọi đổi. */
function resetSelection() {
  addParticipantSearch.value = ''
  selectedContacts.value.clear()
}
watch([() => props.isOpen, () => props.call?.callId], resetSelection)
/** Đóng modal mời người; lựa chọn tạm thuộc component và được reset theo vòng đời mở/đóng. */
const closeAddParticipantModal = () => emit('close')
/** Loại lựa chọn vừa mất khả dụng rồi phát danh sách máy lẻ hợp lệ cho View; chưa tự gọi SDK/API. */
const confirmAddParticipants = () => {
  if (props.loadPage) {
    if (selectedContacts.value.size) emit('confirm', [...selectedContacts.value.values()])
    return
  }
  const selected = availableAddParticipants.value
    .filter(isSelected)
    .map((contact) => String(contact.number).trim())
  if (selected.length) emit('confirm', selected)
}
</script>

<style>
/* CSS chỉ áp dụng trong .calls-view để giữ nguyên layout khi tách component. */
.calls-view .custom-check-box.checked {
  background: #2563eb;
  border-color: #2563eb;
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.35);
}

.calls-view .custom-check-box.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  background: #f1f5f9;
}

.calls-view .tab-config-item.selected {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.calls-view .tab-config-item.disabled {
  cursor: default;
  background: #f8fafc;
  opacity: 0.85;
}
.calls-view .add-participant-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease;
}

.calls-view .add-participant-card {
  width: 90%;
  max-width: 440px;
  max-height: 80vh;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.calls-view .add-participant-header {
  padding: 18px 20px 14px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e2e8f0;
}

.calls-view .add-participant-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.05rem;
  font-weight: 700;
  color: #0f172a;
}

.calls-view .btn-close-modal {
  background: none;
  border: none;
  color: #64748b;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}
.calls-view .btn-close-modal:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.calls-view .add-participant-search {
  padding: 12px 20px;
  border-bottom: 1px solid #f1f5f9;
}

.calls-view .add-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 0.85rem;
  outline: none;
  box-sizing: border-box;
}
.calls-view .add-search-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}

.calls-view .add-participant-list {
  padding: 8px 12px;
  overflow-y: auto;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.calls-view .add-participant-empty {
  padding: 24px 12px;
  text-align: center;
  color: #64748b;
  font-size: 0.88rem;
}

.calls-view .add-participant-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}
.calls-view .add-participant-item:hover {
  background: #f8fafc;
}
.calls-view .add-participant-item.selected {
  background: #eff6ff;
}

.calls-view .add-item-checkbox input {
  cursor: pointer;
  width: 16px;
  height: 16px;
}

.calls-view .add-item-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 0.82rem;
  font-weight: 700;
  flex-shrink: 0;
}

.calls-view .add-item-info {
  flex: 1;
  min-width: 0;
}

.calls-view .add-item-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calls-view .add-item-sub {
  font-size: 0.76rem;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 4px;
}

.calls-view .add-participant-footer {
  padding: 14px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.calls-view .btn-add-cancel {
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.calls-view .btn-add-cancel:hover {
  background: #f1f5f9;
}

.calls-view .btn-add-confirm {
  padding: 8px 18px;
  border-radius: 10px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.calls-view .btn-add-confirm:hover:not(:disabled) {
  background: #1d4ed8;
}
.calls-view .btn-add-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
