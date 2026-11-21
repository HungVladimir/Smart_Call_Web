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

      <div class="add-participant-list">
        <div v-if="availableAddParticipants.length === 0" class="add-participant-empty">
          <p>Không có đồng nghiệp trực tuyến nào khả dụng để mời.</p>
        </div>
        <div
          v-for="c in availableAddParticipants"
          :key="c.uuid || c.number"
          class="add-participant-item"
          :class="{ selected: selectedAddExtensions.includes(String(c.number).trim()) }"
          @click="toggleAddExtension(c.number)"
        >
          <div class="add-item-checkbox">
            <input
              type="checkbox"
              :checked="selectedAddExtensions.includes(String(c.number).trim())"
              @click.stop="toggleAddExtension(c.number)"
            />
          </div>
          <div class="add-item-avatar" :style="{ backgroundColor: getAvatarColor(c.name) }">
            <EmployeeAvatar
              :user-uuid="c.uuid || ''"
              :enabled="Boolean(c.hasEmployeeAvatar)"
              :fallback="getInitials(c.name)"
            />
          </div>
          <div class="add-item-info">
            <div class="add-item-name">{{ c.name }}</div>
            <div class="add-item-sub">
              <span class="add-item-ext">Máy lẻ {{ c.number }}</span>
              <span v-if="c.dept" class="add-item-dept">• {{ c.dept }}</span>
            </div>
          </div>
          <span class="badge-status-pill online">Trực tuyến</span>
        </div>
      </div>

      <div class="add-participant-footer">
        <button class="btn-add-cancel" @click="closeAddParticipantModal">Hủy</button>
        <button
          class="btn-add-confirm"
          :disabled="selectedAddExtensions.length === 0"
          @click="confirmAddParticipants"
        >
          Mời vào cuộc gọi ({{ selectedAddExtensions.length }})
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import EmployeeAvatar from '@/components/EmployeeAvatar.vue'
import { ref, computed, watch } from 'vue'
import { getAvatarInitials as getInitials, getAvatarColor } from '@/utils/avatar.js'

/** Chỉ giữ lựa chọn tạm khi modal mở; gửi danh sách máy lẻ đã chọn cho view xử lý. */
const props = defineProps({
  isOpen: Boolean,
  contacts: { type: Array, required: true },
  call: { type: Object, default: null },
  group: { type: Object, required: true },
  myExtension: { type: String, default: '' },
  canInviteContact: { type: Function, required: true },
})
const emit = defineEmits(['close', 'confirm'])
/**
 * Đọc danh bạ hiện tại theo cơ chế phản ứng của Vue, không tạo bản sao dữ liệu riêng cho giao
 * diện.
 */
const contacts = computed(() => props.contacts)
const addParticipantSearch = ref('')

const selectedAddExtensions = ref([])

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

  let list = contacts.value.filter((c) => {
    const ext = String(c.number || '').trim()
    const isAvail = props.canInviteContact(c)
    return isAvail && !inCallExts.has(ext)
  })

  const q = addParticipantSearch.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.number || '').includes(q) ||
        (c.dept || '').toLowerCase().includes(q),
    )
  }
  return list
})

/** Thêm hoặc bỏ máy lẻ trong lựa chọn tạm của modal, chưa gọi API hoặc gửi lời mời. */
const toggleAddExtension = (ext) => {
  const s = String(ext).trim()
  const idx = selectedAddExtensions.value.indexOf(s)
  if (idx >= 0) {
    selectedAddExtensions.value.splice(idx, 1)
  } else {
    selectedAddExtensions.value.push(s)
  }
}
// Đồng bộ vòng đời mở/đóng modal: reset lựa chọn tạm hoặc dọn tài nguyên không còn dùng.
watch(
  () => props.isOpen,
  () => {
    addParticipantSearch.value = ''
    selectedAddExtensions.value = []
  },
)
/** Đóng modal mời người; lựa chọn tạm thuộc component và được reset theo vòng đời mở/đóng. */
const closeAddParticipantModal = () => emit('close')
/** Loại lựa chọn vừa mất khả dụng rồi phát danh sách máy lẻ hợp lệ cho View; chưa tự gọi SDK/API. */
const confirmAddParticipants = () => {
  const selected = selectedAddExtensions.value.filter((ext) =>
    availableAddParticipants.value.some((contact) => String(contact.number) === ext),
  )
  if (selected.length) emit('confirm', selected)
}
</script>

<style>
/* CSS chỉ áp dụng trong .calls-view để giữ nguyên layout khi tách component. */
.calls-view .status-dot-inline.online {
  background: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
}
.calls-view .pill-dot.online {
  background: #22c55e;
}

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

.calls-view .badge-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 500;
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.calls-view .badge-status-pill.online {
  background: #ecfdf5;
  color: #059669;
  border-color: #a7f3d0;
}

.calls-view .badge-status-pill.busy {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

.calls-view .badge-status-pill.dnd {
  background: #fff7ed;
  color: #c2410c;
  border-color: #fed7aa;
}

.calls-view .badge-status-pill.away {
  background: #fefce8;
  color: #a16207;
  border-color: #fef08a;
}

.calls-view .badge-status-pill.ringing {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}

.calls-view .badge-status-pill.offline {
  background: #f8fafc;
  color: #94a3b8;
  border-color: #e2e8f0;
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
