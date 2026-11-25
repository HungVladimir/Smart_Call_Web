<template>
  <div
    class="contact-item-card"
    :class="{
      favorite: contact.isFavorite,
      'group-selectable': groupSelectionMode,
      'group-selected': groupSelectionMode && selected,
    }"
    @click="groupSelectionMode ? emit('select', contact) : emit('remember', contact)"
  >
    <!-- Checkbox khi ở tab Gọi nhóm -->
    <div
      v-if="groupSelectionMode"
      class="group-select-checkbox-wrap"
      @click.stop="emit('select', contact)"
    >
      <div
        class="custom-check-box"
        :class="{
          checked: selected,
          disabled: isSelf || !canInvite,
        }"
      >
        <UiIcon name="selection-check" v-if="selected" class="check-svg" />
      </div>
    </div>
    <!-- Đánh dấu liên hệ yêu thích khi đang duyệt danh bạ. -->
    <button
      v-else
      class="btn-star"
      :class="{ active: contact.isFavorite }"
      :title="contact.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
      :aria-label="contact.isFavorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'"
      @click.stop="emit('favorite', contact)"
    >
      <UiIcon :name="contact.isFavorite ? 'favorite' : 'favorite-outline'" />
    </button>

    <!-- Ảnh đại diện dạng chữ cái. -->
    <div class="avatar-wrap">
      <div class="contact-avatar" :style="{ backgroundColor: getAvatarColor(contact.name) }">
        {{ getInitials(contact.name) }}
      </div>
    </div>

    <!-- Chấm màu hiển thị trạng thái ngay trước tên nhân viên. -->
    <div class="contact-meta">
      <div class="meta-row-top">
        <div class="name-status-group">
          <ContactPresenceDot :status="contact.status" />
          <strong class="contact-name" :title="contact.name">
            {{ contact.name }}
            <span v-if="isSelf" class="self-badge">(Bạn)</span>
            <span
              v-if="
                contact.isMobileApp &&
                contact.status !== 'offline' &&
                contact.status !== 'unavailable'
              "
              class="mobile-phone-badge"
              title="Đang trực tuyến bằng ứng dụng di động"
            >
              <UiIcon name="mobile" class="phone-svg-icon" width="13" height="13" />
            </span>
          </strong>
        </div>
      </div>
      <div class="meta-row-sub">
        <span class="ext-badge">Máy lẻ {{ contact.number || '---' }}</span>
        <span v-if="contact.dept" class="dept-text" :title="contact.dept"
          >• {{ contact.dept }}</span
        >
      </div>
    </div>

    <!-- Khi chọn thành viên, ưu tiên hiển thị trạng thái lựa chọn. -->
    <div v-if="groupSelectionMode && selected" class="group-select-indicator">
      <span class="badge-group-selected"> <UiIcon name="check-text" /> Đã chọn </span>
    </div>

    <!-- Gọi trực tiếp từ thẻ liên hệ. -->
    <div v-if="!groupSelectionMode" class="contact-actions">
      <button
        class="btn-action-icon call"
        :title="
          !contact.number || !contact.number.trim()
            ? 'Chưa có số máy lẻ'
            : busy
              ? 'Đang bận cuộc gọi'
              : `Gọi máy lẻ ${contact.number}`
        "
        :aria-label="`Gọi cho ${contact.name}`"
        :disabled="busy || !contact.number || !contact.number.trim()"
        @click.stop="emit('call', contact)"
      >
        <UiIcon name="phone-outline" class="action-svg" width="15" height="15" stroke-width="2" />
      </button>
    </div>
  </div>
</template>

<script setup>
import UiIcon from '@/components/common/UiIcon.vue'
import { getAvatarInitials as getInitials, getAvatarColor } from '@/utils/avatar.js'
import ContactPresenceDot from './ContactPresenceDot.vue'
/** Một liên hệ: chỉ hiển thị và phát hành động, không sở hữu danh sách hoặc gọi API. */
defineProps({
  contact: { type: Object, required: true },
  groupSelectionMode: Boolean,
  selected: Boolean,
  isSelf: Boolean,
  canInvite: Boolean,
  busy: Boolean,
})
const emit = defineEmits(['select', 'call', 'favorite', 'remember'])
</script>

<style>
.calls-view .contact-item-card {
  display: flex;
  min-width: 0;
  align-items: center;
  background: #ffffff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 10px 14px;
  gap: 12px;
  transition: all 0.15s ease;
}

.calls-view .contact-item-card:hover {
  background: #f8fafc;
  border-color: #e2e8f0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.calls-view .btn-star {
  background: none;
  border: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: #cbd5e1;
  transition:
    transform 0.15s,
    color 0.15s;
  padding: 4px;
  min-width: 32px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  flex-shrink: 0;
}

.calls-view .btn-star:hover {
  transform: scale(1.2);
  color: #f59e0b;
}

.calls-view .btn-star.active {
  color: #f59e0b;
}

.calls-view .avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.calls-view .contact-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.calls-view .contact-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.calls-view .meta-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.calls-view .name-status-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.calls-view .contact-name {
  font-size: 0.92rem;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calls-view .self-badge {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  color: #059669;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
  vertical-align: middle;
}

.calls-view .mobile-phone-badge {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-left: 5px;
  color: #10b981;
}

.calls-view .phone-svg-icon {
  display: inline-block;
  vertical-align: middle;
}

.calls-view .meta-row-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.74rem;
  color: #64748b;
}

.calls-view .ext-badge {
  background: #e0f2fe;
  color: #0284c7;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.calls-view .dept-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calls-view .contact-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 6px;
}

.calls-view .btn-action-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.92rem;
  transition: all 0.15s;
  position: relative;
}

.calls-view .btn-action-icon .action-svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  transition:
    transform 0.15s ease,
    color 0.15s ease;
}

.calls-view .btn-action-icon:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.calls-view .btn-action-icon:hover:not(:disabled) .action-svg {
  transform: scale(1.12);
}

.calls-view .btn-action-icon.call {
  color: #10b981;
}

.calls-view .btn-action-icon.call:hover:not(:disabled) {
  background: #ecfdf5;
  border-color: #10b981;
  color: #059669;
}

.calls-view .btn-action-icon:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.calls-view .btn-action-icon:disabled * {
  pointer-events: none;
}
.calls-view .group-select-checkbox-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.calls-view .custom-check-box {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 2px solid #cbd5e1;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
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

.calls-view .check-svg {
  width: 13px;
  height: 13px;
  stroke: #ffffff;
}

.calls-view .contact-item-card.group-selectable {
  cursor: pointer;
  user-select: none;
}

.calls-view .contact-item-card.group-selected {
  background: #f8faff;
  border: 1.5px solid #93c5fd !important;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}

.calls-view .group-select-indicator {
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.calls-view .badge-group-selected {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.74rem;
  font-weight: 700;
  background: #dbeafe;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}
</style>
