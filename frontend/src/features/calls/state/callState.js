import { reactive } from 'vue'

/** Nguồn state cuộc gọi Web dùng chung; component đọc state và gửi lệnh qua controller. */
export const callState = reactive({
  isRegistered: false,
  dialing: false,
  activeCall: null,
  incomingCall: null,
  callNotice: null,
})
