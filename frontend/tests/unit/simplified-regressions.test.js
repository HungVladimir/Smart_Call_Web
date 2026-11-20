import { logger } from '../../src/services/common/loggerService.js'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { computed } from 'vue'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
import { handleWazoEvent } from '../../src/services/realtime/wazoEventHandler.js'
const routePorts = vi.hoisted(() => ({ authService: { isAuthenticated: vi.fn() } }))
vi.mock('@/services/index.js', () => routePorts)
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createWebHistory: actual.createMemoryHistory }
})
import router from '../../src/router/index.js'
let app
beforeEach(() => {
  app = createFixture()
  routePorts.authService.isAuthenticated.mockImplementation(() => app.authService.isAuthenticated())
})
afterEach(() => disposeFixture(app))
const call = () => {
  const current = { sipCallId: 'current', callId: 'server-current' }
  app.callService.currentCallSession = current
  app.callState.activeCall = {
    callId: 'current-web',
    number: '2000',
    status: 'ringing',
    session: current,
  }
  app.callService.attachPhoneListeners()
  return current
}

it('F04 accepted cũ không thay nhánh mới trên cùng kết nối SDK', () => {
  const current = call()
  app.callService._onCallAcceptedHandler({ sipCallId: 'old', number: '2000' })
  app.callService._onCallEndedHandler({ sipCallId: 'old' })
  expect(app.callService.currentCallSession).toBe(current)
  expect(app.callState.activeCall.status).toBe('ringing')
  app.callService._onCallAcceptedHandler({ sipCallId: 'current' })
  expect(app.callState.activeCall.status).toBe('connected')
})

it('F04 SDK phát accepted trước Promise vẫn được nhận sau khi xác minh SIP ID', async () => {
  app.callState.activeCall = { callId: 'pending-web', number: '2000', status: 'ringing' }
  app.callService.attachPhoneListeners()
  app.sdk.Phone.call.mockImplementation(async () => {
    app.callService._onCallAcceptedHandler({ sipCallId: 'actual' })
    return { sipCallId: 'actual' }
  })
  await app.callService.placeSdkCall('2000')
  expect(app.callState.activeCall.status).toBe('connected')
  expect(app.callService.currentCallSession.sipCallId).toBe('actual')
})

it('F05 conference_deleted chỉ kết thúc đúng hội nghị hiện tại', () => {
  call()
  Object.assign(app.groupCallService.state, { isGroupCall: true, isGroupHost: false })
  const hangup = vi.spyOn(app.callService, 'hangupCurrentCall').mockImplementation(() => {})
  const event = (name, data) => handleWazoEvent(app, { op: 'event', data: { name, data } })
  event('adhoc_conference_deleted', { id: 'other' })
  event('adhoc_conference_participant_joined', { conference_id: 'wrong', call_id: 'server-old' })
  expect(app.groupCallService.state.activeAdhocConferenceId).toBe('')
  event('adhoc_conference_participant_joined', {
    conference_id: 'current',
    call_id: 'server-current',
  })
  event('adhoc_conference_deleted', { id: 'other' })
  expect(hangup).not.toHaveBeenCalled()
  event('adhoc_conference_deleted', { id: 'current' })
  expect(hangup).toHaveBeenCalledOnce()
})

it('F06 gửi lỗi cập nhật computed của tin nhắn mà không cần đổi phòng', async () => {
  const pending = deferred()
  app.chatService.rooms = [{ id: 'r', messages: [], isDirect: true }]
  fetch.mockReturnValue(pending.promise)
  const sending = app.chatService.sendMessage('r', 'hello')
  const failed = computed(() => app.chatService.rooms[0].messages[0].sendFailed)
  expect(failed.value).toBe(false)
  pending.resolve(response({}, 500))
  await sending
  expect(failed.value).toBe(true)
})

it('F07 tin thường không mở lại phòng đã đóng và service không cho gửi tiếp', async () => {
  app.chatService.rooms = [
    { id: 'r', adminVerified: true, adminUuid: 'admin', isDirect: false, messages: [] },
  ]
  app.chatService.handleIncomingMessage({
    room_uuid: 'r',
    user_uuid: 'admin',
    content: '[SYSTEM:ROOM_CLOSED]',
  })
  app.chatService.handleIncomingMessage({
    room_uuid: 'r',
    user_uuid: 'peer',
    content: 'after close',
  })
  expect(app.chatService.rooms).toHaveLength(0)
  await expect(app.chatService.sendMessage('r', 'new')).rejects.toThrow('đã đóng')
})

it('F07 cold load tìm tombstone ngoài trang tin nhắn gần nhất', async () => {
  app.contactService.currentContacts = [{ uuid: 'a', number: '1000' }]
  fetch.mockImplementation(async (url) => {
    if (url.endsWith('/rooms'))
      return response({
        items: [{ uuid: 'r', name: 'Group', admin_uuid: 'admin', users: ['a', 'admin', 'peer'] }],
      })
    if (url.includes('search='))
      return response({
        items: [{ uuid: 'closed', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]' }],
      })
    throw new Error('Không tải lịch sử phòng đã đóng')
  })
  expect(await app.chatService.getRooms()).toEqual([])
  expect(app.chatService._closedRoomIds.has('r')).toBe(true)
})

it('F07 lịch sử có tin sau tombstone vẫn là phòng đóng', async () => {
  app.chatService.rooms = [
    { id: 'r', adminVerified: true, adminUuid: 'admin', isDirect: false, messages: [] },
  ]
  fetch.mockResolvedValue(
    response({
      items: [
        {
          uuid: 'close',
          user_uuid: 'admin',
          content: '[SYSTEM:ROOM_CLOSED]',
          created_at: '2026-11-20T01:00:00Z',
        },
        { uuid: 'after', user_uuid: 'peer', content: 'hello', created_at: '2026-11-20T02:00:00Z' },
      ],
    }),
  )
  expect(await app.chatService.getRoomMessages('r')).toEqual([])
  expect(app.chatService.rooms).toHaveLength(0)
})

it('F08 không redirect login về chính nó khi cấu hình lưu cũ tắt hết màn hình', async () => {
  localStorage.setItem('smartcall_logged_in', 'true')
  localStorage.setItem(
    'smartcall_features_config',
    JSON.stringify({ calls: false, messages: false, history: false }),
  )
  await router.push('/login')
  expect(router.currentRoute.value.path).toBe('/login')
})

it('logger che credential và xuất được snapshot SDK có tham chiếu vòng', () => {
  logger.clearLogs()
  const details = {
    token: 'private-token',
    password: 'private-password',
    url: 'wss://example.invalid/?token=private-query',
  }
  details.self = details
  logger.info('AUTH', 'GET /api/auth/0.1/token/private-path', details)
  const text = logger.exportLogsText()
  for (const value of ['private-token', 'private-password', 'private-query', 'private-path'])
    expect(text).not.toContain(value)
  expect(text).toContain('Tham chiếu vòng')
})

it('kết quả gọi cũ không tắt ringback của cuộc gọi mới cùng phiên đăng nhập', async () => {
  const pending = deferred()
  app.callState.activeCall = { callId: 'old-web', number: '2000', status: 'ringing' }
  app.sdk.Phone.call.mockReturnValue(pending.promise)
  const old = app.callService.placeSdkCall('2000')
  app.callService.callGeneration += 1
  app.callState.activeCall = { callId: 'new-web', number: '3000', status: 'ringing' }
  app.callService.callToneService.stopAllTones.mockClear()
  pending.resolve({ sipCallId: 'old-sip' })
  await expect(old).rejects.toThrow('hủy')
  expect(app.callService.callToneService.stopAllTones).not.toHaveBeenCalled()
})
