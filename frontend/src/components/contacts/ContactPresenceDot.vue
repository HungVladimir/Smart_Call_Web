<template>
  <span
    class="contact-presence-dot"
    :class="{ 'is-online': isOnline }"
    :title="label"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  ></span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({ status: String })
const onlineStates = new Set(['online', 'busy', 'ringing', 'dnd', 'away'])

/** Chấm xanh cho liên hệ đang kết nối, kể cả khi bận hoặc bật Không làm phiền. */
const isOnline = computed(() => onlineStates.has(props.status))

/** Mô tả chấm bằng chữ cho trình đọc màn hình khi đã xác nhận kết nối. */
const label = computed(() => {
  if (isOnline.value) return 'Trực tuyến'
  if (props.status === 'offline' || props.status === 'unavailable') return 'Ngoại tuyến'
  return undefined
})
</script>

<style scoped>
.contact-presence-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #94a3b8;
}

.contact-presence-dot.is-online {
  background: #22c55e;
}
</style>
