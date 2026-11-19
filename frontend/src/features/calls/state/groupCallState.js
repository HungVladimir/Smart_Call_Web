import { shallowReactive } from 'vue'

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
