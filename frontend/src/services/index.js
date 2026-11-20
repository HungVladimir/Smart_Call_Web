import sdk from '@wazo/sdk'
import { createServices } from './createServices.js'

/** Các instance dùng trong trình duyệt. Chỉ điểm lắp ghép này nạp SDK Wazo thật. */
export const {
  authService,
  settingsService,
  contactService,
  chatService,
  historyService,
  recordingService,
  callService,
  groupCallService,
  eventConnection,
  phoneAdapter,
  eventHub,
} = createServices(sdk)
