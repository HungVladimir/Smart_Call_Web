<template>
  <div class="chat-input-bar">
    <textarea
      ref="input"
      :value="modelValue"
      rows="1"
      class="chat-textarea"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @keydown.enter.exact.prevent="onEnter"
    ></textarea>
    <button class="btn-send" :disabled="disabled || !modelValue.trim()" @click="emit('send')">
      Gửi ➤
    </button>
  </div>
</template>
<script setup>
import { ref, watch, nextTick } from 'vue'

/** Ô soạn chỉ giữ kích thước input và phát sự kiện; quyết định gửi thuộc ChatService. */
const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: Boolean,
  placeholder: { type: String, default: 'Nhập tin nhắn (Shift+Enter xuống dòng, Enter để gửi)...' },
})
const emit = defineEmits(['update:modelValue', 'send'])
const input = ref(null)
/** Điều chỉnh chiều cao ô soạn tin theo nội dung để người dùng nhìn đủ phần đang nhập. */
function resize() {
  if (input.value) {
    input.value.style.height = 'auto'
    input.value.style.height = Math.min(input.value.scrollHeight, 120) + 'px'
  }
}
/** Đồng bộ nội dung ô soạn với v-model của cha và cập nhật chiều cao textarea. */
function onInput(event) {
  emit('update:modelValue', event.target.value)
  resize()
}
/** Gửi khi Enter hợp lệ; giữ Shift+Enter và quá trình ghép ký tự IME để không gửi tin ngoài ý muốn. */
function onEnter(event) {
  if (!event.isComposing && !props.disabled) emit('send')
}
// Đồng bộ state hiển thị khi dữ liệu được theo dõi thay đổi; việc tải/ghi nghiệp vụ vẫn thuộc
// service hoặc handler tương ứng.
watch(
  () => props.modelValue,
  () => nextTick(resize),
)
</script>
<style scoped>
.btn-action {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}

.btn-action:hover {
  background: #f1f5f9;
}
.chat-input-bar {
  background: white;
  padding: 12px 20px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

.chat-input-bar textarea.chat-textarea {
  flex: 1;
  border: 1px solid #cbd5e1;
  border-radius: 18px;
  padding: 10px 16px;
  outline: none;
  font-size: 0.9rem;
  font-family: inherit;
  resize: none;
  line-height: 1.4;
  max-height: 120px;
  min-height: 40px;
  box-sizing: border-box;
}

.chat-input-bar textarea.chat-textarea:focus {
  border-color: #1e88e5;
}

.btn-send {
  background: #1e88e5;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 20px;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-end;
  height: 40px;
}
</style>
