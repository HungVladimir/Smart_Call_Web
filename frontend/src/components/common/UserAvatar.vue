<template>
  <span class="user-avatar-root" :style="{ backgroundColor: displayBg }">
    <span class="user-avatar-fallback" :class="{ 'is-hidden': loaded && canRenderImage }">
      {{ displayText }}
    </span>
    <img
      v-if="canRenderImage"
      :src="avatarUrl"
      :alt="name || ''"
      class="user-avatar-img"
      :class="{ 'is-loaded': loaded }"
      loading="lazy"
      decoding="async"
      @load="handleImageLoad"
      @error="handleImageError"
    />
  </span>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { buildAvatarUrl, getAvatarColor, getAvatarInitials } from '@/utils/avatar.js'
import { hasAvatarFailed, markAvatarFailed } from '@/state/avatarState.js'

/** Hiển thị ảnh đại diện từ proxy theo email/idKnox và tự động fallback sang chữ viết tắt. */
const props = defineProps({
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  size: { type: String, default: 'sm' },
  fallbackText: { type: String, default: undefined },
  fallbackBg: { type: String, default: '' },
  transparentFallback: { type: Boolean, default: false },
})

const loaded = ref(false)
const avatarUrl = computed(() => buildAvatarUrl(props.email, props.size))
const canRenderImage = computed(() => Boolean(avatarUrl.value && !hasAvatarFailed(avatarUrl.value)))
const displayText = computed(() =>
  props.fallbackText !== undefined ? props.fallbackText : getAvatarInitials(props.name),
)
const displayBg = computed(() => {
  if (props.transparentFallback) return 'transparent'
  return props.fallbackBg || getAvatarColor(props.name)
})

/** Đặt lại trạng thái đã tải khi chuyển sang người dùng hoặc kích thước ảnh khác. */
function resetLoadedState() {
  loaded.value = false
}

watch(avatarUrl, resetLoadedState)

/** Đánh dấu ảnh đã sẵn sàng để ẩn chữ viết tắt phía dưới. */
function handleImageLoad() {
  loaded.value = true
}

/** Ghi nhớ URL lỗi vào RAM phiên và quay lại hiển thị chữ viết tắt. */
function handleImageError() {
  loaded.value = false
  markAvatarFailed(avatarUrl.value)
}
</script>

<style scoped>
:where(.user-avatar-root) {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  user-select: none;
}

.user-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.user-avatar-fallback.is-hidden {
  opacity: 0;
}

.user-avatar-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.user-avatar-img.is-loaded {
  opacity: 1;
}
</style>
