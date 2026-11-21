<template>
  <span ref="container" class="employee-avatar">
    <img v-if="imageUrl" :src="imageUrl" alt="" @error="imageUrl = ''" />
    <span v-else>{{ fallback }}</span>
  </span>
</template>

<script setup>
import { inject, onMounted, onBeforeUnmount, ref, watch } from 'vue'
// Điểm khởi tạo ứng dụng cung cấp loader; component hiển thị không tự khởi tạo SDK/service.
const loadAvatar = inject('loadEmployeeAvatar', async () => '')

const props = defineProps({
  userUuid: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  fallback: { type: String, default: '' },
})
const container = ref(null)
const imageUrl = ref('')
const visible = ref(false)
let observer = null
let generation = 0

// Chỉ tải thumbnail khi avatar đi vào vùng nhìn; service sở hữu HTTP/cache và cleanup theo phiên.
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') visible.value = true
  else {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        visible.value = true
        observer.disconnect()
      }
    })
    observer.observe(container.value)
  }
})
watch(
  () => [props.userUuid, props.enabled, visible.value],
  async () => {
    const requestGeneration = ++generation
    imageUrl.value = ''
    if (!props.enabled || !props.userUuid || !visible.value) return
    const url = await loadAvatar(props.userUuid)
    if (generation === requestGeneration) imageUrl.value = url
  },
)
// Request đến muộn không được cập nhật component đã rời màn hình.
onBeforeUnmount(() => {
  generation++
  observer?.disconnect()
})
</script>

<style scoped>
.employee-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  overflow: hidden;
}
.employee-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
