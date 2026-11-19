import { WazoApiClient } from '../core/http/WazoApiClient.js'
import { SettingsService } from '../features/settings/services/SettingsService.js'
import { handleWazoEvent } from '../features/calls/services/handleWazoEvent.js'
import { AuthService } from '../features/auth/services/AuthService.js'
import { ContactService } from '../features/contacts/services/ContactService.js'
import { ChatService } from '../features/messages/services/ChatService.js'
import { HistoryService } from '../features/history/services/HistoryService.js'
import { RecordingService } from '../features/calls/services/RecordingService.js'
import { CallController } from '../features/calls/services/CallController.js'
import { GroupCallController } from '../features/calls/services/GroupCallController.js'
import { PhoneAdapter } from '../core/wazo/PhoneAdapter.js'
import { CallControlApi } from '../core/wazo/CallControlApi.js'
import { EventConnection } from '../core/wazo/EventConnection.js'
import { EventHub } from '../core/events/EventHub.js'
import { callState } from '../features/calls/state/callState.js'
import { callToneService } from '../core/audio/CallToneService.js'

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
  const chatService = new ChatService({ authService, contactService, eventHub })
  const callControlApi = new CallControlApi({ authService })
  const callController = new CallController({
    sdk,
    authService,
    phoneAdapter,
    contactService,
    historyService,
    recordingService,
    callToneService,
    callControlApi,
  })
  const groupCallController = new GroupCallController({
    sdk,
    authService,
    callController,
    contactService,
    callControlApi,
    phoneAdapter,
    callToneService,
  })
  callController.attachGroupCoordinator(groupCallController)
  const eventContext = { authService, callController, groupCallController, eventHub }
  const eventConnection = new EventConnection({
    authService,
    onEnvelope: (envelope) => handleWazoEvent(eventContext, envelope),
  })
  eventContext.eventConnection = eventConnection
  authService.attachLifecycle({
    callController,
    eventConnection,
    contactService,
    chatService,
    historyService,
    recordingService,
  })
  return {
    authService,
    settingsService,
    contactService,
    chatService,
    callControlApi,
    historyService,
    recordingService,
    callController,
    groupCallController,
    eventConnection,
    phoneAdapter,
    eventHub,
  }
}
