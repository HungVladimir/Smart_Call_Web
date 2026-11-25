<template>
  <svg
    class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'users'">
      <path
        d="M15 20v-2.1a3.9 3.9 0 0 0-3.9-3.9H6.9A3.9 3.9 0 0 0 3 17.9V20m18 0v-2.1c0-1.8-1.2-3.3-2.8-3.7M16 4.2a3.3 3.3 0 0 1 0 6.4"
      />
      <circle cx="9" cy="7.5" r="3.4" />
    </template>
    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />
    <path v-else-if="name === 'back'" d="m10 6-6 6 6 6m-6-6h16" />
    <path v-else-if="name === 'close'" d="m6 6 12 12M18 6 6 18" />
    <path v-else-if="name === 'check'" d="m5 12 4 4L19 6" />
    <path v-else-if="name === 'info'" d="M12 11v5m0-8h.01m9 4a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    <path
      v-else-if="name === 'phone'"
      d="m7 3 3 5-2.4 2a14 14 0 0 0 6.4 6.4l2-2.4 5 3v1.6a2.4 2.4 0 0 1-2.7 2.4A17.6 17.6 0 0 1 3 5.7 2.4 2.4 0 0 1 5.4 3Z"
    />
    <path
      v-else-if="name === 'edit'"
      d="m13.8 6.2 4 4M4 20l4.6-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z"
    />
    <path
      v-else-if="name === 'trash'"
      d="M4 7h16m-10 4v6m4-6v6M6 7l1 12c.1 1 .8 2 2 2h6c1.2 0 1.9-1 2-2l1-12M9 7V4h6v3"
    />
  </svg>
</template>

<script setup>
/** Icon nét chung cho điều hướng và thao tác, tên hiển thị thuộc nút chứa icon. */
defineProps({ name: { type: String, required: true } })
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
