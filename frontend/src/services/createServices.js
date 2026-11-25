import { WazoApiClient } from './common/apiClient.js'
import { SettingsService } from './data/settingsService.js'
import { handleWazoEvent } from './realtime/wazoEventHandler.js'
import { AuthService } from './auth/authService.js'
import { ContactService } from './data/contactService.js'
import { HistoryService } from './data/historyService.js'
import { RecordingService } from './audio/recordingService.js'
import { CallService } from './calls/callService.js'
import { GroupCallService } from './calls/groupCallService.js'
import { PhoneAdapter } from './audio/wazoPhone.js'
import { CallControlApi } from './calls/callApi.js'
import { EventConnection } from './realtime/wazoEvents.js'
import { EventHub } from './realtime/eventBus.js'
import { callState } from '../state/callState.js'
import { callToneService } from './audio/audioService.js'

/** Tạo và nối các dịch vụ tại một nơi; test có thể truyền SDK giả ở ranh giới. */
export function createServices(sdk) {
  const eventHub = new EventHub()
  const phoneAdapter = new PhoneAdapter({ sdk, isCallActive: () => Boolean(callState.activeCall) })
  const authService = new AuthService({ sdk, phoneAdapter })
  const apiClient = new WazoApiClient({ authService })
  const settingsService = new SettingsService({ apiClient })
  const contactService = new ContactService({ authService })
  const historyService = new HistoryService({ authService })
  const recordingService = new RecordingService({ authService })
  const callControlApi = new CallControlApi({ authService })
  const callService = new CallService({
    sdk,
    authService,
    phoneAdapter,
    contactService,
    historyService,
    recordingService,
    callToneService,
    callControlApi,
  })
  const groupCallService = new GroupCallService({
    sdk,
    authService,
    callService,
    contactService,
    callControlApi,
    phoneAdapter,
    callToneService,
  })
  callService.attachGroupCoordinator(groupCallService)
  const eventContext = {
    authService,
    callService,
    groupCallService,
    contactService,
    eventHub,
  }
  const eventConnection = new EventConnection({
    authService,
    onEnvelope: (envelope) => handleWazoEvent(eventContext, envelope),
    onConnected: resyncConnectedServices,
    onDisconnected: markDirectoryPresenceStale,
  })
  /** Trạng thái từ socket cũ không còn đủ tin cậy sau khi mất kết nối. */
  function markDirectoryPresenceStale() {
    contactService.invalidateDirectoryPresence()
  }
  /** Khôi phục hội nghị và yêu cầu các view đang mở đồng bộ lại presence sau reconnect. */
  function resyncConnectedServices() {
    window.dispatchEvent(new Event('smartcall-directory-reconnect'))
    return groupCallService
      ._requestGroupStateSync('socket-' + groupCallService._createGroupSignalId())
      .catch(() => {})
  }
  eventContext.eventConnection = eventConnection
  authService.attachLifecycle({
    callService,
    eventConnection,
    contactService,
    historyService,
    recordingService,
  })
  return {
    authService,
    settingsService,
    contactService,
    callControlApi,
    historyService,
    recordingService,
    callService,
    groupCallService,
    eventConnection,
    phoneAdapter,
    eventHub,
  }
}
