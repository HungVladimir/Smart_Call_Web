import { reactive, shallowReactive } from 'vue'

/** Nguồn state cuộc gọi Web dùng chung; component đọc state và gửi lệnh qua controller. */
export const callState = reactive({
  isRegistered: false,
  dialing: false,
  activeCall: null,
  incomingCall: null,
  callNotice: null,
})

/** Tạo state hội nghị; Map dùng shallowReactive để tránh bọc sâu SIP session của SDK. */
export function createGroupCallState() {
  return shallowReactive({
    activeAdhocConferenceId: '',
    isGroupCall: false,
    isGroupHost: false,
    groupHostExtension: '',
    groupParticipantExtensions: [],
    extensionToWazoCallIdMap: new Map(),
    mergedCallIds: new Set(),
    secondaryCallSessions: shallowReactive(new Map()),
  })
}

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
