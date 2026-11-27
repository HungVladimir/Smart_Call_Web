<template>
  <section class="dialer-col">
    <div class="dialer-box">
      <div class="dialer-screen">
        <input
          :value="modelValue"
          @input="emit('update:modelValue', $event.target.value)"
          type="tel"
          placeholder="Nhập số máy lẻ..."
          aria-label="Nhập số máy lẻ cần gọi"
          maxlength="8"
          @keyup.enter="emit('dial')"
        />
      </div>

      <!-- SMART CONTACT PREVIEW KHI GÕ SỐ (CỐ ĐỊNH VỊ TRÍ, KHÔNG GÂY GIẬT BÀN PHÍM) -->
      <div
        class="smart-contact-preview-card"
        :class="{
          'is-empty': !modelValue || isCalling,
          'has-contact': Boolean(contact && modelValue),
        }"
      >
        <template v-if="modelValue && contact">
          <UserAvatar
            class="preview-avatar"
            :name="contact.name"
            :email="contact.email"
            size="sm"
          />
          <div class="preview-info">
            <div class="preview-header-line">
              <span class="preview-name">{{ contact.name }}</span>
              <span v-if="contact.dept" class="preview-dept-badge">{{ contact.dept }}</span>
            </div>
            <div class="preview-meta-line">
              <ContactPresenceDot :status="contact.status" />
              <span class="preview-ext-number">Máy lẻ: {{ modelValue }}</span>
            </div>
          </div>
        </template>
        <template v-else-if="modelValue">
          <div class="preview-avatar unknown-avatar">
            <span>#</span>
          </div>
          <div class="preview-info">
            <div class="preview-header-line">
              <span class="preview-name">Máy lẻ {{ modelValue }}</span>
            </div>
            <div class="preview-meta-line">
              <span v-if="previewMessage" class="preview-unknown-note">{{ previewMessage }}</span>
            </div>
          </div>
        </template>
      </div>

      <div class="keypad-grid">
        <button v-for="k in keys" :key="k.num" class="key-btn" @click="emit('digit', k.num)">
          <span class="num">{{ k.num }}</span>
          <small v-if="k.sub">{{ k.sub }}</small>
        </button>
      </div>

      <div class="dial-actions">
        <button
          class="btn-dial"
          title="Bắt đầu gọi"
          :disabled="isCalling || isDialing"
          @click="emit('dial')"
        >
          <UiIcon name="phone-filled" class="dial-svg-icon" width="22" height="22" />
        </button>
        <button
          class="btn-clear"
          :class="{ visible: Boolean(modelValue) }"
          title="Xóa một số"
          aria-label="Xóa ký tự cuối"
          :disabled="!modelValue"
          @click="emit('erase')"
        >
          <UiIcon name="backspace" class="clear-svg-icon" width="22" height="22" />
        </button>
      </div>
    </div>
  </section>
</template>
<script setup>
import UiIcon from '@/components/common/UiIcon.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import ContactPresenceDot from '@/components/contacts/ContactPresenceDot.vue'

/** Panel nhập số: chỉ phát ý định người dùng, không tự gọi SDK hay giữ state cuộc gọi. */
defineProps({
  modelValue: { type: String, default: '' },
  contact: { type: Object, default: null },
  previewMessage: { type: String, default: '' },
  isCalling: Boolean,
  isDialing: Boolean,
})
const emit = defineEmits(['update:modelValue', 'dial', 'digit', 'erase'])
const keys = [
  { num: '1', sub: '' },
  { num: '2', sub: 'ABC' },
  { num: '3', sub: 'DEF' },
  { num: '4', sub: 'GHI' },
  { num: '5', sub: 'JKL' },
  { num: '6', sub: 'MNO' },
  { num: '7', sub: 'PQRS' },
  { num: '8', sub: 'TUV' },
  { num: '9', sub: 'WXYZ' },
  { num: '*', sub: '' },
  { num: '0', sub: '+' },
  { num: '#', sub: '' },
]
</script>
<style scoped>
.dialer-col {
  width: 320px;
  min-width: 300px;
  flex-shrink: 0;
  margin-right: 20px;
  transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.dialer-box {
  height: 580px;
  max-height: 580px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: white;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.dialer-screen input {
  width: 100%;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: 2px;
  color: #1e293b;
  text-align: center;
  outline: none;
  margin-bottom: 12px;
  transition: all 0.2s;
}

.dialer-screen input:focus {
  border-color: #3b82f6;
  background: white;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.smart-contact-preview-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  height: 54px;
  min-height: 54px;
  max-height: 54px;
  box-sizing: border-box;
  overflow: hidden;
  transition:
    opacity 0.2s ease,
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.smart-contact-preview-card.is-empty {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.smart-contact-preview-card.has-contact {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.preview-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  color: #ffffff;
  font-weight: 700;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.preview-avatar.unknown-avatar {
  background: #94a3b8;
  color: #ffffff;
  font-size: 1.1rem;
}

.preview-info {
  flex: 1;
  min-width: 0;
}

.preview-header-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.preview-name {
  font-weight: 600;
  font-size: 0.85rem;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-dept-badge {
  font-size: 0.7rem;
  background: #e2e8f0;
  color: #475569;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
}

.preview-meta-line {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  color: #64748b;
}

.preview-ext-number {
  font-weight: 600;
  color: #3b82f6;
}

.preview-unknown-note {
  font-style: italic;
  color: #94a3b8;
  font-size: 0.72rem;
}

.keypad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.key-btn {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 50%;
  width: 58px;
  height: 58px;
  margin: 0 auto;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.key-btn:hover {
  background: #e2e8f0;
  transform: scale(1.05);
}

.key-btn small {
  font-size: 0.52rem;
  color: #64748b;
  font-weight: normal;
  margin-top: -3px;
}

.dial-actions {
  display: flex;
  gap: 20px;
  justify-content: center;
  align-items: center;
  margin-top: 6px;
}

.btn-dial {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
  transition: all 0.2s;
}

.btn-dial:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #047857 100%);
  transform: scale(1.06);
  box-shadow: 0 6px 18px rgba(16, 185, 129, 0.45);
}

.btn-dial:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.dial-svg-icon {
  width: 22px;
  height: 22px;
  fill: #ffffff;
  flex-shrink: 0;
}

.btn-clear {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #f1f5f9;
  color: #64748b;
  border: 1.5px solid #cbd5e1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0.35;
}

.btn-clear.visible {
  opacity: 1;
}

.btn-clear:hover:not(:disabled) {
  background: #fee2e2;
  color: #ef4444;
  border-color: #fca5a5;
  transform: scale(1.06);
}

.btn-clear:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
}

.clear-svg-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
@media (max-width: 1199px) and (min-width: 768px) {
  .dialer-col {
    width: 300px;
    margin-right: 0;
  }
}
@media (max-width: 768px) {
  .dialer-box {
    padding: 16px;
    height: auto;
    max-height: none;
  }

  .key-btn {
    width: 52px;
    height: 52px;
    font-size: 1.15rem;
  }
}
</style>
