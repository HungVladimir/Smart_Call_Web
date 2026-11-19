import { reactive } from 'vue'

/** State ghi âm server; tách biệt với việc phát lại file ghi âm trong lịch sử. */
export const recordingState = reactive({
  isRecording: false,
  isStarting: false,
  isStopping: false,
  error: '',
  duration: 0,
  currentCallId: null, // ID cuộc gọi trên máy chủ Wazo Calld
  meta: null,
})
