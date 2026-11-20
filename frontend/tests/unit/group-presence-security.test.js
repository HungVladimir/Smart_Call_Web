import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createFixture, disposeFixture } from '../helpers/createFixture.js'
import { handleWazoEvent } from '../../src/services/realtime/wazoEventHandler.js'
let app
beforeEach(() => {
  app = createFixture()
  app.contactService.currentContacts = [
    { uuid: 'host', number: '2000' },
    { uuid: 'member', number: '3000' },
    { uuid: 'outsider', number: '9000' },
  ]
  app.callService.currentCallSession = { sipCallId: 'peer' }
  app.callState.activeCall = {
    callId: 'current',
    number: '2000',
    session: app.callService.currentCallSession,
    status: 'connected',
    direction: 'inbound',
  }
  vi.spyOn(app.groupCallService, 'addParticipantsToGroupCall').mockResolvedValue()
  vi.spyOn(app.groupCallService, 'handleParticipantLeftGroupCall').mockImplementation(() => {})
})
afterEach(() => disposeFixture(app))
function emit(uuid, status, extra = {}) {
  handleWazoEvent(app, {
    op: 'event',
    data: { name: 'chatd_presence_updated', data: { user_uuid: uuid, status, ...extra } },
  })
}
function host() {
  app.callState.activeCall.number = '3000'
  Object.assign(app.groupCallService.state, {
    isGroupCall: true,
    isGroupHost: true,
    groupHostExtension: '1000',
    groupParticipantExtensions: ['1000', '3000'],
  })
}
it('AUDIT-01 người ngoài không yêu cầu host quay số qua ADD_REQ', () => {
  host()
  emit('outsider', '[ADD_REQ:request:1000:2000]')
  expect(app.groupCallService.addParticipantsToGroupCall).not.toHaveBeenCalled()
})
it('AUDIT-02 người ngoài không thể phát LEFT thay thành viên', () => {
  host()
  emit('outsider', '[LEFT:3000]')
  expect(app.groupCallService.handleParticipantLeftGroupCall).not.toHaveBeenCalled()
})
it('thành viên không được phát LEFT cho người khác', () => {
  host()
  emit('member', '[LEFT:1000]')
  expect(app.groupCallService.handleParticipantLeftGroupCall).not.toHaveBeenCalled()
})
it('LEFT hợp lệ chỉ áp dụng cho chính thành viên đã xác thực', () => {
  host()
  emit('member', '[LEFT:3000]')
  expect(app.groupCallService.handleParticipantLeftGroupCall).toHaveBeenCalledWith('3000')
})
it('host xác lập từ peer hiện tại được công bố GROUP', () => {
  emit('host', 'Đang gọi [GROUP:2000:2000,1000,3000]-smartcall-android')
  expect(app.groupCallService.state).toMatchObject({
    isGroupCall: true,
    isGroupHost: false,
    groupHostExtension: '2000',
    groupParticipantExtensions: ['2000', '1000', '3000'],
  })
})
it.each([
  ['outsider', '[GROUP:2000:1000,2000]'],
  ['outsider', '[GROUP:9000:1000,9000]'],
  ['member', '[GROUP:2000:1000,2000]'],
  ['', '[GROUP:2000:1000,2000]'],
  ['unknown', '[GROUP:2000:1000,2000]'],
  ['a', '[GROUP:1000:1000,2000]'],
])('GROUP không hợp lệ từ %s không thay vai trò', (sender, status) => {
  emit(sender, status)
  expect(app.groupCallService.state.isGroupCall).toBe(false)
})
it('không cho đổi host đã xác lập bằng một GROUP mới', () => {
  emit('host', '[GROUP:2000:1000,2000,9000]')
  emit('outsider', '[GROUP:9000:1000,9000]')
  expect(app.groupCallService.state.groupHostExtension).toBe('2000')
})
it('UUID mâu thuẫn hoặc máy lẻ không xác định duy nhất bị bỏ qua', () => {
  emit('host', '[GROUP:2000:1000,2000]', { uuid: 'outsider' })
  expect(app.groupCallService.state.isGroupCall).toBe(false)
  app.contactService.currentContacts.push({ uuid: 'duplicate', number: '2000' })
  emit('host', '[GROUP:2000:1000,2000]')
  expect(app.groupCallService.state.isGroupCall).toBe(false)
})
it('request hợp lệ từ thành viên được xử lý một lần và không bị người ngoài chiếm request ID', () => {
  host()
  emit('outsider', '[ADD_REQ:same:1000:2000]')
  emit('member', '[ADD_REQ:same:1000:2000]')
  emit('member', '[ADD_REQ:same:1000:2000]')
  expect(app.groupCallService.addParticipantsToGroupCall).toHaveBeenCalledExactlyOnceWith(['2000'])
})
it('giữ ADD_REQ Android cũ nhưng gộp lặp trong cùng cuộc gọi', () => {
  host()
  emit('member', '[ADD_REQ:1000:2000]')
  emit('member', '[ADD_REQ:1000:2000]')
  expect(app.groupCallService.addParticipantsToGroupCall).toHaveBeenCalledTimes(1)
  app.groupCallService.resetGroupState()
  host()
  emit('member', '[ADD_REQ:1000:2000]')
  expect(app.groupCallService.addParticipantsToGroupCall).toHaveBeenCalledTimes(2)
})
it('chỉ host hiện tại được phát NOTICE và dedupe thông báo', () => {
  emit('host', '[GROUP:2000:1000,2000,3000]')
  const received = [],
    onToast = (e) => received.push(e.detail)
  window.addEventListener('app-toast', onToast)
  try {
    emit('member', '[NOTICE:n:2000:Giả danh]')
    emit('host', '[NOTICE:n:2000:Thông báo thật]')
    emit('host', '[NOTICE:n:2000:Thông báo thật]')
    expect(received).toEqual([{ type: 'warning', message: '🔔 Thông báo thật' }])
  } finally {
    window.removeEventListener('app-toast', onToast)
  }
})
it('không thực thi tín hiệu khi không còn call hoặc đã bị thu hồi phiên', () => {
  host()
  app.callState.activeCall = null
  emit('member', '[ADD_REQ:one:1000:2000]')
  app.callState.activeCall = { number: '2000' }
  app.authService.isSessionRevoked = true
  emit('member', '[ADD_REQ:two:1000:2000]')
  expect(app.groupCallService.addParticipantsToGroupCall).not.toHaveBeenCalled()
})
it('member không phát lại GROUP để tự nhận quyền host', () => {
  emit('host', '[GROUP:2000:1000,2000]')
  app.groupCallService.broadcastGroupStateViaPresence()
  expect(app.authService.updatePresence).not.toHaveBeenCalled()
})

it('người mới được mời nhưng chưa kết nối không được yêu cầu mời thêm', () => {
  host()
  app.callState.activeCall.number = '2000'
  emit('member', '[ADD_REQ:pending:1000:4000]')
  expect(app.groupCallService.addParticipantsToGroupCall).not.toHaveBeenCalled()
  app.groupCallService.state.extensionToWazoCallIdMap.set('3000', 'server-member')
  emit('member', '[ADD_REQ:connected:1000:4000]')
  expect(app.groupCallService.addParticipantsToGroupCall).toHaveBeenCalledTimes(1)
})
