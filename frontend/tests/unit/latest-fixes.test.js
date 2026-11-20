import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { computed } from 'vue'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
import { flushUi } from '../helpers/mountComponent.js'
import { handleWazoEvent } from '../../src/services/realtime/wazoEventHandler.js'
import { ChatService } from '../../src/services/data/chatService.js'
import { callToneService } from '../../src/services/audio/audioService.js'
let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => disposeFixture(app))

/** Gắn cuộc gọi đã kết nối và danh bạ thật về mặt schema; SDK/API vẫn là ranh giới kiểm thử. */
function connectedCall(direction = 'outbound') {
  app.contactService.currentContacts = [
    { uuid: 'a', number: '1000' },
    { uuid: 'peer', number: '2000' },
    { uuid: 'c', number: '3000' },
    { uuid: 'other', number: '4000' },
  ]
  vi.spyOn(app.contactService, 'isContactAvailableForCall').mockReturnValue(true)
  app.callService.currentCallSession = { sipCallId: 'primary', answered: true }
  app.callState.activeCall = {
    callId: 'call',
    number: '2000',
    direction,
    status: 'connected',
    session: app.callService.currentCallSession,
  }
  app.callService.attachPhoneListeners()
  vi.spyOn(app.callControlApi, 'deleteConference').mockResolvedValue(true)
  vi.spyOn(app.callControlApi, 'hangupServerCall').mockResolvedValue(true)
}
/** Phát đúng envelope Wazo để kiểm tra cả routing và quy tắc service. */
function event(name, data) {
  handleWazoEvent(app, { op: 'event', data: { name, data } })
}
/** Giữ REST tạo phòng đang chờ để tái hiện kết thúc kênh xảy ra trước ACK. */
async function pendingConference() {
  connectedCall()
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  const secondary = app.groupCallService.state.secondaryCallSessions.get('3000')
  app.callService._onCallAcceptedHandler(secondary)
  app.callControlApi.listActiveCalls = vi.fn(async () => [
    { id: 'host', sip_call_id: 'primary', talking_to: { B: {} } },
    { id: 'child', sip_call_id: secondary.sipCallId, talking_to: { C: {} } },
  ])
  const pending = deferred()
  vi.spyOn(app.callControlApi, 'createConference').mockImplementation(() => pending.promise)
  app.groupCallService.syncActiveCallsToAdhocConference()
  vi.advanceTimersByTime(350)
  await flushUi()
  expect(app.callControlApi.createConference).toHaveBeenCalled()
  return { pending, secondary }
}

it('người nhận cuộc gọi chỉ ủy quyền cho người gọi ban đầu, không tự gọi C hoặc nhận host', async () => {
  connectedCall('inbound')
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  expect(app.groupCallService.state.isGroupHost).toBe(false)
  expect(app.groupCallService.state.isGroupCall).toBe(false)
  expect(app.authService.updatePresence).toHaveBeenCalledWith(
    'unavailable',
    expect.stringMatching(/ADD_REQ:.*:2000:3000/),
  )
})

it('người gọi A nhận yêu cầu hợp lệ từ B, gọi C và giữ host; A cúp dọn cả B/C', async () => {
  connectedCall()
  event('chatd_presence_updated', { uuid: 'peer', status: '[ADD_REQ:r:1000:3000]' })
  await flushUi()
  expect(app.sdk.Phone.call).toHaveBeenCalledExactlyOnceWith('3000', false)
  expect(app.groupCallService.state).toMatchObject({
    isGroupHost: true,
    groupHostExtension: '1000',
    groupParticipantExtensions: ['1000', '2000', '3000'],
  })
  app.groupCallService.state.activeAdhocConferenceId = 'conference'
  app.groupCallService.state.extensionToWazoCallIdMap.set('2000', 'B')
  app.groupCallService.state.extensionToWazoCallIdMap.set('3000', 'C')
  app.callService.hangupCurrentCall()
  expect(app.callControlApi.deleteConference).toHaveBeenCalledWith('conference')
  expect(app.callControlApi.hangupServerCall).toHaveBeenCalledWith('B')
  expect(app.callControlApi.hangupServerCall).toHaveBeenCalledWith('C')
  expect(app.callState.activeCall).toBeNull()
})

it('người ngoài, peer đang đổ chuông hoặc GROUP từ B không đổi host A', async () => {
  connectedCall()
  event('chatd_presence_updated', { uuid: 'c', status: '[ADD_REQ:x:1000:4000]' })
  app.callState.activeCall.status = 'ringing'
  event('chatd_presence_updated', { uuid: 'peer', status: '[ADD_REQ:x:1000:3000]' })
  app.callState.activeCall.status = 'connected'
  event('chatd_presence_updated', { uuid: 'peer', status: '[GROUP:2000:1000,2000,3000]' })
  await flushUi()
  expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  expect(app.groupCallService.state.isGroupCall).toBe(false)
})

it('ADD_REQ lỗi hoặc ACK sau cúp không báo gửi thành công và không tạo nhóm ở B', async () => {
  connectedCall('inbound')
  app.authService.updatePresence.mockResolvedValue(false)
  await expect(app.groupCallService.addParticipantsToGroupCall(['3000'])).rejects.toThrow(
    'Không gửi được',
  )
  const pending = deferred()
  app.authService.updatePresence.mockReturnValue(pending.promise)
  const messages = []
  const onToast = (e) => messages.push(e.detail.message)
  window.addEventListener('app-toast', onToast)
  try {
    const inviting = app.groupCallService.addParticipantsToGroupCall(['3000'])
    app.callService.hangupCurrentCall()
    pending.resolve(true)
    await inviting
    expect(messages.some((m) => m.includes('Đã gửi yêu cầu'))).toBe(false)
    expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('app-toast', onToast)
  }
})

it('kênh cũ kết thúc không báo C rời; event đúng phòng mới gỡ và không thông báo trùng', async () => {
  connectedCall()
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  const group = app.groupCallService.state
  group.activeAdhocConferenceId = 'conference'
  group.extensionToWazoCallIdMap.set('2000', 'B')
  group.extensionToWazoCallIdMap.set('3000', 123)
  group.mergedCallIds.add(123)
  const messages = []
  const onToast = (e) => messages.push(e.detail.message)
  window.addEventListener('app-toast', onToast)
  try {
    event('call_ended', { call_id: 123, reason_code: 26 })
    app.callService._onCallEndedHandler(group.secondaryCallSessions.get('3000'))
    event('adhoc_conference_participant_left', { conference_id: 'old', call_id: 123 })
    expect(group.groupParticipantExtensions).toContain('3000')
    expect(messages.some((m) => m.includes('đã rời'))).toBe(false)
    event('adhoc_conference_participant_left', { conference_id: 'conference', call_id: 123 })
    event('adhoc_conference_participant_left', { conference_id: 'conference', call_id: 123 })
    expect(group.groupParticipantExtensions).not.toContain('3000')
    expect(messages.filter((m) => m.includes('đã rời'))).toHaveLength(1)
    expect(app.callState.activeCall).not.toBeNull()
  } finally {
    window.removeEventListener('app-toast', onToast)
  }
})

it('C kết thúc kênh khi REST ghép chờ: sau thành công vẫn giữ C và dọn queue', async () => {
  const { pending, secondary } = await pendingConference()
  app.callService._onCallEndedHandler(secondary)
  expect(app.groupCallService._pendingConferenceTerminations.size).toBe(1)
  expect(app.groupCallService.state.groupParticipantExtensions).toContain('3000')
  pending.resolve('conference')
  await flushUi()
  expect(app.groupCallService._pendingConferenceTerminations.size).toBe(0)
  expect(app.groupCallService.state.groupParticipantExtensions).toContain('3000')
})

it('REST ghép thất bại không giữ C giả trong nhóm', async () => {
  const { pending, secondary } = await pendingConference()
  app.callService._onCallEndedHandler(secondary)
  pending.resolve(null)
  await flushUi()
  expect(app.groupCallService._pendingConferenceTerminations.size).toBe(0)
  expect(app.groupCallService.state.groupParticipantExtensions).not.toContain('3000')
  expect(app.callState.activeCall).not.toBeNull()
})

it('A cúp khi REST ghép chờ: xóa queue, dọn phòng trả muộn và không phục hồi nhóm', async () => {
  const { pending, secondary } = await pendingConference()
  app.callService._onCallEndedHandler(secondary)
  app.callService.hangupCurrentCall()
  expect(app.groupCallService._pendingConferenceTerminations.size).toBe(0)
  pending.resolve('late')
  await flushUi()
  expect(app.callControlApi.deleteConference).toHaveBeenCalledWith('late')
  expect(app.callState.activeCall).toBeNull()
  expect(app.groupCallService.state.isGroupCall).toBe(false)
})

it('B rời đúng hội nghị thì A và C tiếp tục, không chuyển host', async () => {
  connectedCall()
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  app.groupCallService.state.activeAdhocConferenceId = 'conference'
  app.groupCallService.state.extensionToWazoCallIdMap.set('2000', 'B')
  app.groupCallService.state.extensionToWazoCallIdMap.set('3000', 'C')
  event('adhoc_conference_participant_left', { conference_id: 'conference', call_id: 'B' })
  expect(app.groupCallService.state.groupParticipantExtensions).toEqual(['1000', '3000'])
  expect(app.groupCallService.state.groupHostExtension).toBe('1000')
  expect(app.callControlApi.deleteConference).not.toHaveBeenCalled()
})

/** Cài phòng đã được xác minh để kiểm tra riêng đếm/khử trùng tin đến. */
function chatRooms(chat = app.chatService) {
  chat.rooms = [
    { id: 'r', title: 'Hội thoại', isDirect: true, members: [], messages: [] },
    { id: 'other', title: 'Khác', isDirect: true, members: [], messages: [] },
  ]
  return chat
}
/** Payload của server, không dựa vào tên thiết bị hoặc alias để đếm tin của người khác. */
function receive(id, room = 'r', sender = 'peer', chat = app.chatService) {
  chat.handleIncomingMessage({
    uuid: id,
    room_uuid: room,
    user_uuid: sender,
    content: 'Tin ' + id,
    created_at: '2026-11-20T02:00:00Z',
  })
}
/** Service mới mô phỏng reload, dùng lại storage và dependency xác thực của đúng tài khoản. */
function reloadedChat() {
  const chat = new ChatService({
    authService: app.authService,
    contactService: app.contactService,
    eventHub: { on: vi.fn() },
  })
  chatRooms(chat)
  chat.getRooms = vi.fn(async () => chat.rooms)
  return chat
}

it('badge Web/Mobile khử trùng UUID, không đếm self echo và tổng khớp từng phòng', () => {
  chatRooms()
  const total = computed(() => app.chatService.totalUnread)
  receive('one')
  app.chatService.handleIncomingMessage({
    uuid: 'wrapper',
    message: { uuid: 'two', room: { uuid: 'r' }, sender_uuid: 'peer', content: 'Mobile' },
  })
  receive('two')
  receive('own', 'r', 'a')
  receive('third', 'other')
  expect(app.chatService.getUnreadCount('r')).toBe(2)
  expect(total.value).toBe(3)
  app.chatService.setVisibleRoom('r')
  expect(total.value).toBe(1)
  receive('one')
  expect(app.chatService.getUnreadCount('r')).toBe(0)
})

it('badge chỉ xóa khi cửa sổ thực sự hiển thị; KeepAlive/rời view vẫn đếm', () => {
  chatRooms()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  app.chatService.setVisibleRoom('r')
  receive('visible')
  expect(app.chatService.totalUnread).toBe(0)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  receive('hidden')
  expect(app.chatService.totalUnread).toBe(1)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  app.chatService.setVisibleRoom('r')
  expect(app.chatService.totalUnread).toBe(1)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  app.chatService.setVisibleRoom('r')
  expect(app.chatService.totalUnread).toBe(0)
  app.chatService.setVisibleRoom(null)
  receive('away')
  expect(app.chatService.totalUnread).toBe(1)
})

it('badge không bỏ sót event đã có trong REST và giữ số khi room object được thay', async () => {
  chatRooms()
  app.chatService.rooms[0].messages.push({ id: 'one', text: 'REST' })
  receive('one')
  expect(app.chatService.totalUnread).toBe(1)
  app.chatService.rooms = [...app.chatService.rooms].map((room) => ({ ...room }))
  receive('one')
  expect(app.chatService.totalUnread).toBe(1)
})

it('reload giữ số, mở phòng rồi reload không báo lại; cache không chứa nội dung/token', async () => {
  chatRooms()
  receive('one')
  receive('two')
  const raw = localStorage.getItem(app.chatService._unreadStorageKey)
  expect(raw).not.toContain('Tin one')
  expect(raw).not.toContain('fixture-token')
  const next = reloadedChat()
  await next.restoreUnreadNotifications()
  expect(next.totalUnread).toBe(2)
  receive('one', 'r', 'peer', next)
  expect(next.totalUnread).toBe(2)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  next.setVisibleRoom('r')
  const last = reloadedChat()
  await last.restoreUnreadNotifications()
  receive('one', 'r', 'peer', last)
  expect(last.totalUnread).toBe(0)
})

it('logout giữ cache A nhưng B và tổng đài khác không dùng chung số', async () => {
  chatRooms()
  receive('one')
  const key = app.chatService._unreadStorageKey
  app.chatService.reset()
  expect(localStorage.getItem(key)).not.toBeNull()
  app.authService.session.uuid = 'b'
  const other = reloadedChat()
  await other.restoreUnreadNotifications()
  expect(other.totalUnread).toBe(0)
  app.authService.session.uuid = 'a'
  const same = reloadedChat()
  await same.restoreUnreadNotifications()
  expect(same.totalUnread).toBe(1)
  app.authService.host = 'another.invalid'
  const server = reloadedChat()
  await server.restoreUnreadNotifications()
  expect(server.totalUnread).toBe(0)
})

it('cache hỏng/quota lỗi không chặn nhận tin và đếm trong RAM', async () => {
  chatRooms()
  receive('one')
  const key = app.chatService._unreadStorageKey
  localStorage.setItem(key, 'bad-json')
  const next = reloadedChat()
  await next.restoreUnreadNotifications()
  expect(next.totalUnread).toBe(0)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })
  receive('new', 'r', 'peer', next)
  expect(next.totalUnread).toBe(1)
})

it('xóa tin/đóng phòng cập nhật số và cache; lệnh quản trị không tự tăng badge', () => {
  chatRooms()
  Object.assign(app.chatService.rooms[0], {
    isDirect: false,
    adminUuid: 'admin',
    adminVerified: true,
  })
  receive('one')
  receive('two')
  app.chatService.handleIncomingMessage({
    uuid: 'delete',
    room_uuid: 'r',
    user_uuid: 'admin',
    content: '[SYSTEM:MSG_DELETED:ids="one"]',
  })
  expect(app.chatService.totalUnread).toBe(1)
  app.chatService.handleIncomingMessage({
    uuid: 'close',
    room_uuid: 'r',
    user_uuid: 'admin',
    content: '[SYSTEM:ROOM_CLOSED]',
  })
  expect(app.chatService.totalUnread).toBe(0)
  expect(
    JSON.parse(localStorage.getItem(app.chatService._unreadStorageKey)).rooms.r,
  ).toBeUndefined()
})

it('phím số không mở AudioContext lần đầu, cache âm và bắt lỗi play bất đồng bộ', async () => {
  callToneService.dtmfAudio = null
  callToneService.dtmfToneUrls.clear()
  const openingContext = vi.spyOn(callToneService, '_getAudioContext').mockImplementation(() => {
    throw new Error('Cold driver')
  })
  const pending = deferred()
  let elements = 0
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        elements++
      }
      pause() {}
      play() {
        return pending.promise
      }
    },
  )
  callToneService.playDtmfTone('1')
  callToneService.playDtmfTone('1')
  callToneService.playDtmfTone('2')
  expect(openingContext).not.toHaveBeenCalled()
  expect(elements).toBe(1)
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
  callToneService.stopAllTones.mockRestore()
  callToneService.stopAllTones()
  expect(callToneService.dtmfAudio.currentTime).toBe(0)
  pending.reject(new Error('Autoplay blocked'))
  await flushUi()
})

it('phòng mới được REST nạp kèm tin trước callback vẫn được đếm một lần', async () => {
  app.contactService.currentContacts = [{ uuid: 'peer', number: '2000' }]
  fetch.mockImplementation(async (url) =>
    url.endsWith('/rooms')
      ? response({ items: [{ uuid: 'new', users: ['a', 'peer'] }] })
      : response({
          items: [
            {
              uuid: 'message',
              user_uuid: 'peer',
              content: 'Tin mới',
              created_at: '2026-11-20T02:00:00Z',
            },
          ],
        }),
  )
  app.chatService.handleIncomingMessage({
    uuid: 'message',
    room_uuid: 'new',
    user_uuid: 'peer',
    content: 'Tin mới',
  })
  await flushUi()
  await flushUi()
  expect(app.chatService.getUnreadCount('new')).toBe(1)
})

it('logout trong lúc metadata phòng chờ không khôi phục badge bằng callback cũ', async () => {
  app.contactService.currentContacts = [{ uuid: 'peer', number: '2000' }]
  const pending = deferred()
  fetch.mockReturnValue(pending.promise)
  app.chatService.handleIncomingMessage({
    uuid: 'old',
    room_uuid: 'private',
    user_uuid: 'peer',
    content: 'Phiên cũ',
  })
  app.authService.logout()
  pending.resolve(response({ items: [{ uuid: 'private', users: ['a', 'peer'] }] }))
  await flushUi()
  expect(app.chatService.totalUnread).toBe(0)
  expect(app.chatService.getUnreadCount('private')).toBe(0)
})

it('snapshot nhóm chỉ đếm C sau accepted, trước đó C là đang mời', async () => {
  connectedCall()
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  expect(app.callState.activeCall.groupConnectedExtensions).toEqual(['1000', '2000'])
  expect(app.callState.activeCall.groupPendingExtensions).toEqual(['3000'])
  app.callService._onCallAcceptedHandler(
    app.groupCallService.state.secondaryCallSessions.get('3000'),
  )
  expect(app.callState.activeCall.groupConnectedExtensions).toEqual(['1000', '2000', '3000'])
  expect(app.callState.activeCall.groupPendingExtensions).toEqual([])
})

it('GROUP tới trước incoming: máy mới xin lại và áp dụng snapshot vào incoming/active', async () => {
  connectedCall('inbound')
  app.callState.activeCall = null
  app.callService.currentCallSession = null
  const prefix = '[GROUP:2000:2000,1000,3000]'
  event('chatd_presence_updated', {
    uuid: 'peer',
    status: prefix + '[GROUP_STATE:room:1:2000,3000]',
  })
  expect(app.groupCallService.state.isGroupCall).toBe(false)
  const session = { sipCallId: 'incoming', number: '2000' }
  app.callService._onCallIncomingHandler(session)
  await flushUi()
  const request = [...app.groupCallService._groupSyncRequestIds][0]
  expect(request).toBeTruthy()
  event('chatd_presence_updated', {
    uuid: 'peer',
    status: prefix + '[GROUP_STATE:room:2:2000,3000:' + request + ']',
  })
  expect(app.callState.incomingCall.isGroupCall).toBe(true)
  await app.callService.acceptIncomingCall()
  event('chatd_presence_updated', {
    uuid: 'peer',
    status: prefix + '[GROUP_STATE:room:3:2000,1000,3000]',
  })
  expect(app.callState.activeCall.groupConnectedExtensions).toHaveLength(3)
  expect(app.callState.activeCall.isGroupCall).toBe(true)
})

it('snapshot cũ hoặc GROUP legacy không ghi đè số 3 đã xác nhận', () => {
  connectedCall('inbound')
  const prefix = '[GROUP:2000:2000,1000,3000]'
  event('chatd_presence_updated', {
    uuid: 'peer',
    status: prefix + '[GROUP_STATE:room:2:2000,1000,3000]',
  })
  event('chatd_presence_updated', {
    uuid: 'peer',
    status: prefix + '[GROUP_STATE:room:1:2000,1000]',
  })
  event('chatd_presence_updated', { uuid: 'peer', status: prefix })
  expect(app.callState.activeCall.groupTitle).toBe('Cuộc gọi nhóm (3 người)')
})

it('Calld nhiều talking_to giữ riêng ID B/C và bổ sung accepted đã lỡ', async () => {
  connectedCall()
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  const state = app.groupCallService.state
  state.activeAdhocConferenceId = 'conf'
  state.extensionToWazoCallIdMap.set('2000', 'B')
  state.extensionToWazoCallIdMap.set('3000', 'C')
  state.mergedCallIds.add('B')
  state.mergedCallIds.add('C')
  state.secondaryCallSessions.clear()
  app.callControlApi.listActiveCalls = vi.fn(async () => [
    { id: 'host', sip_call_id: 'primary', status: 'talking', talking_to: { B: {}, C: {} } },
  ])
  await app.groupCallService.synchronizeActiveCalls()
  expect(state.extensionToWazoCallIdMap.get('2000')).toBe('B')
  expect(state.extensionToWazoCallIdMap.get('3000')).toBe('C')
  expect(app.callState.activeCall.groupConnectedExtensions).toHaveLength(3)
})

it('SDK trả null dọn người đang mời và cúp dọn snapshot/request', async () => {
  connectedCall()
  app.sdk.Phone.call.mockResolvedValue(null)
  await app.groupCallService.addParticipantsToGroupCall(['3000'])
  expect(app.callState.activeCall.groupPendingExtensions).toEqual([])
  app.callService.hangupCurrentCall()
  expect(app.groupCallService._groupSnapshotId).toBe('')
  expect(app.groupCallService._groupSyncRequestIds.size).toBe(0)
})
