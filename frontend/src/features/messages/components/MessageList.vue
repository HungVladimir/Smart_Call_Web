<template>
  <div ref="container" class="chat-messages">
    <div v-if="loading" class="messages-loading">
      <div class="spinner-circle"></div>
      <span>Đang tải tin nhắn từ máy chủ...</span>
    </div>
    <div v-else-if="!messages || messages.length === 0" class="messages-empty">
      <p>Chưa có tin nhắn nào trong cuộc trò chuyện này.</p>
    </div>
    <template v-else>
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="msg-bubble-wrap"
        :class="msg.sender === 'mine' || msg.sender === 'me' ? 'mine' : 'theirs'"
      >
        <span class="msg-sender">{{
          msg.sender === 'mine' || msg.sender === 'me' ? 'Tôi' : msg.senderName
        }}</span>
        <div class="msg-bubble">
          {{ msg.text }}
        </div>
        <div class="msg-meta">
          <span>{{ msg.time }}</span>
          <span v-if="msg.sendFailed" class="send-error" role="status">Gửi thất bại</span>
        </div>
      </div>
    </template>
  </div>
</template>
<script setup>
import { ref } from 'vue'

/** Danh sách chỉ hiển thị nội dung/thời gian và lỗi gửi; không có ghim hoặc read receipts. */
defineProps({ messages: { type: Array, default: () => [] }, loading: Boolean })
const container = ref(null)
/** Cho page yêu cầu cuộn sau cập nhật, không tiết lộ DOM element ra service. */
function scrollToBottom() {
  if (container.value) container.value.scrollTop = container.value.scrollHeight
}
defineExpose({ scrollToBottom })
</script>
<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.msg-bubble-wrap {
  display: flex;
  flex-direction: column;
  max-width: 65%;
}

.msg-bubble-wrap.mine {
  align-self: flex-end;
  align-items: flex-end;
}

.msg-bubble-wrap.theirs {
  align-self: flex-start;
  align-items: flex-start;
}

.msg-sender {
  font-size: 0.75rem;
  color: #64748b;
  margin-bottom: 3px;
}

.msg-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 100%;
}

.msg-bubble-wrap.mine .msg-bubble {
  background: #0284c7;
  color: white;
  border-bottom-right-radius: 2px;
  box-shadow: 0 1px 4px rgba(2, 132, 199, 0.3);
}

.msg-bubble-wrap.mine .msg-sender {
  color: #0284c7;
  font-weight: 600;
}

.msg-bubble-wrap.theirs .msg-bubble {
  background: white;
  color: #1e293b;
  border: 1px solid #e2e8f0;
  border-bottom-left-radius: 2px;
}

.send-error {
  color: #dc2626;
  font-weight: 500;
}

.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.7rem;
  color: #94a3b8;
  margin-top: 4px;
}

.spinner-circle {
  width: 28px;
  height: 28px;
  border: 3px solid #e2e8f0;
  border-top-color: #1e88e5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
</style>
