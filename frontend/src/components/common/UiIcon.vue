<template>
  <span v-if="glyph" aria-hidden="true" v-bind="$attrs">{{ glyph }}</span>
  <svg
    v-else-if="svgAttributes"
    :class="{ 'ui-icon': svgAttributes === compactOutline }"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    v-bind="{ ...svgAttributes, ...$attrs }"
  >
    <template v-if="name === 'user-plus'">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </template>
    <path
      v-else-if="name === 'phone-filled'"
      d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.74 11.74 0 018.57 3.9a1 1 0 00-1-1H4.07a1 1 0 00-1 1A17.93 17.93 0 0021 20.93a1 1 0 001-1v-3.55a1 1 0 00-1-1h-.99z"
    />
    <path
      v-else-if="name === 'backspace'"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.5-7.5H21a1 1 0 011 1v13a1 1 0 01-1 1H9.5L3 12z"
    />
    <path
      v-else-if="name === 'microphone'"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8"
    />
    <template v-else-if="name === 'microphone-off'">
      <line x1="1" y1="1" x2="23" y2="23" stroke-linecap="round" />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6"
      />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M17 16.95A7 7 0 015 11m12 0a6.97 6.97 0 01-.64 2.92M12 19v4m-4 0h8"
      />
    </template>
    <template v-else-if="name === 'record'">
      <circle cx="12" cy="12" r="5" fill="#ef4444" stroke="#ef4444" />
      <circle cx="12" cy="12" r="9" stroke="#ef4444" stroke-width="2" />
    </template>
    <path
      v-else-if="name === 'hangup'"
      d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 010-1.41C3.28 8.82 7.42 7 12 7s8.72 1.82 11.71 4.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"
    />
    <path
      v-else-if="name === 'phone-outline'"
      d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"
    />
    <path
      v-else-if="name === 'reject'"
      d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C2.56 9.42 6.98 8 12 8s9.44 1.42 11.71 3.67c.39.39.39 1.02 0 1.41l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"
    />
    <path
      v-else-if="name === 'user'"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
    <template v-else-if="name === 'lock'">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M7 11V7a5 5 0 0110 0v4" />
    </template>
    <template v-else-if="name === 'eye'">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </template>
    <path
      v-else-if="name === 'eye-off'"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
    />
    <path
      v-else-if="name === 'warning-outline'"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
    <path
      v-else-if="name === 'forward'"
      stroke-linecap="round"
      stroke-linejoin="round"
      d="M14 5l7 7m0 0l-7 7m7-7H3"
    />
    <template v-else-if="name === 'info-outline'">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </template>
    <polyline v-else-if="name === 'selection-check'" points="20 6 9 17 4 12" />
    <template v-else-if="name === 'mobile'">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </template>
    <template v-else-if="name === 'users'">
      <path
        d="M15 20v-2.1a3.9 3.9 0 0 0-3.9-3.9H6.9A3.9 3.9 0 0 0 3 17.9V20m18 0v-2.1c0-1.8-1.2-3.3-2.8-3.7M16 4.2a3.3 3.3 0 0 1 0 6.4"
      />
      <circle cx="9" cy="7.5" r="3.4" />
    </template>
    <path
      v-else-if="name === 'phone'"
      d="m7 3 3 5-2.4 2a14 14 0 0 0 6.4 6.4l2-2.4 5 3v1.6a2.4 2.4 0 0 1-2.7 2.4A17.6 17.6 0 0 1 3 5.7 2.4 2.4 0 0 1 5.4 3Z"
    />
    <path v-else-if="name === 'back'" d="m10 6-6 6 6 6m-6-6h16" />
    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />
    <path v-else-if="name === 'info'" d="M12 11v5m0-8h.01m9 4a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    <path
      v-else-if="name === 'edit'"
      d="m13.8 6.2 4 4M4 20l4.6-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"
    />
    <path
      v-else-if="name === 'trash'"
      d="M4 7h16m-10 4v6m4-6v6M6 7l1 12c.1 1 .8 2 2 2h6c1.2 0 1.9-1 2-2l1-12M9 7V4h6v3"
    />
    <path v-else-if="name === 'close'" d="m6 6 12 12M18 6 6 18" />
    <path v-else-if="name === 'check'" d="m5 12 4 4L19 6" />
  </svg>
</template>

<script>
/** Ký tự hiển thị của UiIcon, dùng trực tiếp khi HTML chỉ nhận văn bản như option. */
export const iconGlyphs = Object.freeze({
  warning: '⚠️',
  settings: '⚙️',
  'close-heavy': '✖',
  'close-text': '✕',
  remove: '×',
  'microphone-text': '🎙️',
  'phone-text': '📞',
  'lock-text': '🔒',
  globe: '🌐',
  flag: '🚩',
  speaker: '🔊',
  email: '📧',
  history: '🕒',
  refresh: '🔄',
  clipboard: '📋',
  'trash-text': '🗑️',
  antenna: '📡',
  mouse: '🖱️',
  'status-available': '🟢',
  'status-away': '🟡',
  'status-busy': '🔴',
  'status-idle': '⚪',
  logout: '🚪',
  tip: '💡',
  'users-text': '👥',
  hourglass: '⏳',
  'record-dot': '●',
  search: '🔍',
  'call-inbound': '↙',
  'call-outbound': '↗',
  pause: '⏸️',
  play: '▶️',
  download: '⬇️',
  favorite: '⭐',
  'favorite-outline': '☆',
  'check-text': '✓',
  'muted-text': '🔇',
  key: '🔑',
  'success-text': '✅',
  'error-text': '❌',
  'download-inbox': '📥',
  'stop-text': '⏹️',
  'arrow-right': '→',
})
</script>

<script setup>
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps({ name: { type: String, required: true } })

const outlined = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }
const rounded = { ...outlined, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
const compactOutline = { ...rounded, 'stroke-width': 1.75 }
const solid = { fill: 'currentColor' }

const svgIcons = {
  'user-plus': rounded,
  'phone-filled': solid,
  backspace: outlined,
  microphone: outlined,
  'microphone-off': outlined,
  record: outlined,
  hangup: solid,
  'phone-outline': { ...rounded, 'stroke-width': 2.5 },
  reject: solid,
  user: outlined,
  lock: outlined,
  eye: outlined,
  'eye-off': outlined,
  'warning-outline': outlined,
  forward: outlined,
  'info-outline': outlined,
  'selection-check': { ...rounded, 'stroke-width': 3.5 },
  mobile: { ...rounded, 'stroke-width': 2.2 },
  users: compactOutline,
  phone: compactOutline,
  back: compactOutline,
  plus: compactOutline,
  info: compactOutline,
  edit: compactOutline,
  trash: compactOutline,
  close: compactOutline,
  check: compactOutline,
}

/** Lấy ký tự đã đăng ký và dùng cùng kiểu chữ với giao diện chứa icon. */
const glyph = computed(function getGlyph() {
  return Object.hasOwn(iconGlyphs, props.name) ? iconGlyphs[props.name] : null
})

/** Lấy nét hoặc màu tô mặc định của SVG. Nơi gọi có thể ghi đè thuộc tính khi cần. */
const svgAttributes = computed(function getSvgAttributes() {
  return Object.hasOwn(svgIcons, props.name) ? svgIcons[props.name] : null
})
</script>

<style scoped>
.ui-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  vertical-align: middle;
}
</style>
