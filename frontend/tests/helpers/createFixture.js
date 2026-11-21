import { vi } from 'vitest'
import { createServices } from '../../src/services/createServices.js'
import { callState } from '../../src/state/callState.js'
import { recordingState } from '../../src/state/callState.js'
import { userSessionState } from '../../src/state/sessionState.js'
import { callToneService } from '../../src/services/audio/audioService.js'
import { logger } from '../../src/services/common/loggerService.js'
import { invalidateSession } from '../../src/services/auth/sessionScope.js'

/** Chỉ dùng trong test: thay ranh giới mạng/SDK, giữ nguyên module và Vue reactivity thực. */
export function createFixture() {
  vi.useFakeTimers()
  vi.spyOn(logger, '_printToConsole').mockImplementation(() => {})
  localStorage.clear()
  sessionStorage.clear()
  invalidateSession()
  localStorage.setItem('smartcall_user_uuid', 'a')
  localStorage.setItem('smartcall_wazo_token', 'fixture-token')
  Object.assign(userSessionState, {
    userUuid: 'a',
    extension: '1000',
    displayName: 'Fixture',
    department: '',
    hasEmployeeAvatar: false,
  })
  Object.assign(callState, {
    activeCall: null,
    incomingCall: null,
    isRegistered: false,
    dialing: false,
    callNotice: null,
  })
  Object.assign(recordingState, {
    isRecording: false,
    isStarting: false,
    isStopping: false,
    duration: 0,
    currentCallId: null,
    error: '',
    meta: null,
  })
  const phone = {
    on: vi.fn(),
    off: vi.fn(),
    eventEmitter: { removeAllListeners: vi.fn() },
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    hangup: vi.fn(async () => {}),
    accept: vi.fn(async () => 'accepted'),
    reject: vi.fn(),
    call: vi.fn(async () => ({ sipCallId: 'sip-fixture' })),
    getRemoteStream: vi.fn(() => null),
    mute: vi.fn(),
    unmute: vi.fn(),
  }
  for (const name of [
    'REGISTERED',
    'UNREGISTERED',
    'PROGRESS',
    'CALL_INCOMING',
    'CALL_ACCEPTED',
    'CALL_ENDED',
    'CALL_FAILED',
    'CALL_REJECTED',
    'CALL_CANCELED',
  ])
    phone['ON_' + name] = name
  const sdk = {
    Phone: phone,
    Auth: {
      init: vi.fn(),
      setClientId: vi.fn(),
      setHost: vi.fn(),
      logout: vi.fn(),
      setApiToken: vi.fn(),
      setToken: vi.fn(),
      logIn: vi.fn(),
      validateToken: vi.fn(),
    },
  }
  for (const name of [
    'startRingbackTone',
    'stopRingbackTone',
    'stopIncomingRingtone',
    'startIncomingRingtone',
    'stopAllTones',
    'playCallEndedTone',
  ])
    vi.spyOn(callToneService, name).mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Request ngoài kịch bản kiểm thử')
    }),
  )
  URL.createObjectURL = vi.fn(() => 'blob:fixture')
  URL.revokeObjectURL = vi.fn()
  const services = createServices(sdk)
  services.authService.session = { token: 'fixture-token', uuid: 'a', primaryNumber: () => '1000' }
  services.authService.updatePresence = vi.fn(async () => true)
  services.contactService.reset()
  return { ...services, sdk, callState, recordingState, userSessionState }
}

/** Điều khiển thứ tự phản hồi để kiểm tra hủy/đổi phiên và request đến muộn. */
export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export function response(data = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => '',
    blob: async () => new Blob(['fixture']),
  }
}

export function disposeFixture(fixture) {
  fixture?.authService.stopSessionHealthCheck()
  fixture?.contactService.dispose()
  fixture?.callService.detachPhoneListeners()
  fixture?.recordingService.clearSessionCache()
  invalidateSession()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
}
