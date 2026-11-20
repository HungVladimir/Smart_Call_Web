# Ca tái hiện cho lượt audit sau refactor

Các ca kiểm tra trong tài liệu cố ý đặt kỳ vọng hành vi an toàn. Trên commit a85d6dc, kết quả là **9 không đạt, 2 đối chứng đạt**. Không dùng kết quả này thay kiểm tra Wazo thật. Ca SDK auth mô phỏng side effect đã đối chiếu mã SDK 0.49.11; không đăng nhập tổng đài.

## Chuẩn bị

1. Cài dependency bằng npm ci trong frontend.
2. Tạo thư mục .refactor-tmp tại gốc clone nếu chưa có.
3. Lưu ba đoạn mã bên dưới vào đúng tên file ở từng tiêu đề.
4. Chạy tại gốc clone:

```powershell
node frontend/node_modules/vitest/vitest.mjs run --config .refactor-tmp/audit.vitest.config.mjs --reporter=verbose
```

Suite này dùng test helper đã có trong frontend/tests/helpers, HTTP/SDK fixture và happy-dom. Không thêm nó vào suite chính khi các vấn đề còn mở. Khi sửa từng nhóm, đưa ca phù hợp vào frontend/tests để kiểm tra hồi quy lâu dài.

Việc root của config đặt tại gốc clone nhằm tìm các file audit nằm ngoài frontend/tests. Alias Vitest trỏ đúng dependency đã cài trong frontend; không cần cài package tại gốc.

## .refactor-tmp/audit.vitest.config.mjs

```javascript
import base from '../frontend/vitest.config.js'
import { fileURLToPath } from 'node:url'
export default { ...base, resolve: { ...base.resolve, alias: { ...base.resolve.alias, vitest: fileURLToPath(new URL('../frontend/node_modules/vitest/dist/index.js', import.meta.url)) } }, root: fileURLToPath(new URL('../', import.meta.url)), test: { ...base.test, include: ['.refactor-tmp/followup-risk.test.js', '.refactor-tmp/audit-router.test.js'] } }

```

## .refactor-tmp/followup-risk.test.js

```javascript
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { computed } from '../frontend/node_modules/vue/dist/vue.runtime.esm-bundler.js'
import { createFixture, disposeFixture, deferred, response } from '../frontend/tests/helpers/createFixture.js'
import { handleWazoEvent } from '../frontend/src/features/calls/services/handleWazoEvent.js'
import { invalidateSession } from '../frontend/src/core/session/sessionScope.js'

let app
beforeEach(() => { app = createFixture() })
afterEach(() => disposeFixture(app))
function presence(data) { handleWazoEvent(app, { op: 'event', data: { name: 'chatd_presence_updated', data } }) }

it('AUDIT-01 người ngoài không được dùng presence yêu cầu host mời thêm máy lẻ', () => {
  app.callState.activeCall = { callId: 'c', number: '4321', status: 'connected' }
  Object.assign(app.groupCallController.state, { isGroupCall: true, isGroupHost: true, groupParticipantExtensions: ['1000', '4321'] })
  vi.spyOn(app.groupCallController, 'addParticipantsToGroupCall').mockResolvedValue()
  presence({ user_uuid: 'outsider', status: '[ADD_REQ:forged:1000:5678]' })
  expect(app.groupCallController.addParticipantsToGroupCall).not.toHaveBeenCalled()
})

it('AUDIT-02 người ngoài không được giả tín hiệu LEFT để loại người khác', () => {
  app.callState.activeCall = { callId: 'c', status: 'connected' }
  app.groupCallController.state.groupParticipantExtensions = ['1000', '4321']
  vi.spyOn(app.groupCallController, 'handleParticipantLeftGroupCall').mockImplementation(() => {})
  presence({ user_uuid: 'outsider', status: '[LEFT:4321]' })
  expect(app.groupCallController.handleParticipantLeftGroupCall).not.toHaveBeenCalled()
})

it('AUDIT-03 sự kiện xóa conference khác không cúp conference đang tham gia', () => {
  app.callState.activeCall = { callId: 'c', status: 'connected' }
  Object.assign(app.groupCallController.state, { isGroupCall: true, isGroupHost: false, activeAdhocConferenceId: 'mine' })
  vi.spyOn(app.callController, 'hangupCurrentCall').mockImplementation(() => {})
  handleWazoEvent(app, { op: 'event', data: { name: 'adhoc_conference_deleted', data: { conference_id: 'other' } } })
  expect(app.callController.hangupCurrentCall).not.toHaveBeenCalled()
})

it('AUDIT-04 thu hồi phiên phải vô hiệu token và request chat đang chờ', async () => {
  const pending = deferred()
  fetch.mockImplementation(() => pending.promise)
  app.chatService.rooms = [{ id: 'r', messages: [] }]
  const loading = app.chatService.getRoomMessages('r')
  app.authService.handleSessionRevocation()
  pending.resolve(response({ items: [{ uuid: 'secret', user_uuid: 'peer', content: 'Nội dung riêng tư', created_at: '2026-11-19T10:00:00Z' }] }))
  await loading
  expect.soft(app.authService.isAuthenticated()).toBe(false)
  expect.soft(app.chatService.rooms).toHaveLength(0)
})

it('AUDIT-05 callback accepted của cuộc gọi cũ không được thay phiên gọi hiện tại', () => {
  app.callController.attachPhoneListeners()
  const current = { sipCallId: 'current' }
  app.callState.activeCall = { callId: 'new', session: current, number: '4321', status: 'ringing' }
  app.callController.currentCallSession = current
  app.callController._onCallAcceptedHandler({ sipCallId: 'old' })
  expect(app.callController.currentCallSession.sipCallId).toBe('current')
  expect(app.callState.activeCall.status).toBe('ringing')
})

it('CONTROL-06 stop của phiên A không xóa ghi âm của phiên B sau invalidateSession thật', async () => {
  const old = deferred()
  fetch.mockImplementationOnce(() => old.promise)
  Object.assign(app.recordingState, { isRecording: true, currentCallId: 'a' })
  const stoppingA = app.recordingService.stopRecording()
  const rejected = expect(stoppingA).rejects.toMatchObject({ name: 'StaleSessionError' })
  invalidateSession()
  app.recordingService.clearSessionCache()
  localStorage.setItem('smartcall_user_uuid', 'b')
  Object.assign(app.recordingState, { isRecording: true, currentCallId: 'b', duration: 9 })
  old.resolve(response({}, 204))
  await rejected
  expect(app.recordingState.currentCallId).toBe('b')
})

it('AUDIT-07 tin nhắn bị server echo trước HTTP ACK chỉ xuất hiện một lần', async () => {
  const pending = deferred()
  fetch.mockImplementation(() => pending.promise)
  app.chatService.rooms = [{ id: 'r', isDirect: true, messages: [] }]
  const sending = app.chatService.sendMessage('r', 'Nội dung')
  app.chatService.handleIncomingMessage({ room_uuid: 'r', uuid: 'server-id', user_uuid: 'a', content: 'Nội dung', created_at: '2026-11-19T10:00:00Z' })
  pending.resolve(response({ uuid: 'server-id' }))
  await sending
  expect(app.chatService.rooms[0].messages.filter(message => message.id === 'server-id')).toHaveLength(1)
})

it('AUDIT-08 lỗi gửi phải kích hoạt Vue reactivity cho nhãn sendFailed', async () => {
  const pending = deferred()
  fetch.mockImplementation(() => pending.promise)
  app.chatService.rooms = [{ id: 'r', isDirect: true, messages: [] }]
  const sending = app.chatService.sendMessage('r', 'Nội dung')
  const state = computed(() => app.chatService.rooms[0].messages[0]?.sendFailed || false)
  expect(state.value).toBe(false)
  pending.resolve(response({}, 500))
  await sending
  expect(state.value).toBe(true)
})

it('AUDIT-09 pending SDK authentication cũ không được ghi session SDK đè phiên mới', async () => {
  const old = deferred(), started = deferred()
  // Mô phỏng side effect sau await của SDK _onAuthenticated đã kiểm tra trong package 0.49.11.
  const sdkAuth = app.sdk.Auth
  sdkAuth.session = null
  sdkAuth.logIn.mockImplementationOnce(async () => {
    started.resolve()
    await old.promise
    sdkAuth.session = { token: 'old-token', uuid: 'old' }
    return sdkAuth.session
  }).mockImplementationOnce(async () => {
    sdkAuth.session = { token: 'new-token', uuid: 'new' }
    return sdkAuth.session
  })
  app.authService.synchronizeUserProfile = vi.fn(async () => {})
  app.historyService.reload = vi.fn(async () => [])
  app.eventConnection.connect = vi.fn()
  app.callController.connect = vi.fn(async () => true)
  const oldLogin = app.authService.login('old', 'fixture')
  const rejected = expect(oldLogin).rejects.toThrow('quá thời gian')
  await started.promise
  await vi.advanceTimersByTimeAsync(15000)
  await rejected
  await app.authService.login('new', 'fixture')
  old.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(sdkAuth.session.uuid).toBe('new')
})

it('AUDIT-10 nhóm đã đóng không được mở lại chỉ vì thành viên gửi tin thường', async () => {
  app.chatService.rooms = [{ id: 'r', isDirect: false, adminVerified: true, adminUuid: 'admin', messages: [] }]
  fetch.mockResolvedValue(response({ items: [
    { uuid: 'closed', user_uuid: 'admin', content: '[SYSTEM:ROOM_CLOSED]', created_at: '2026-11-19T10:00:00Z' },
    { uuid: 'new', user_uuid: 'ordinary', content: 'Vẫn gửi được', created_at: '2026-11-19T10:01:00Z' },
  ] }))
  await app.chatService.getRoomMessages('r')
  expect(app.chatService.rooms[0].isClosed).toBe(true)
})

```

## .refactor-tmp/audit-router.test.js

```javascript
import { it, expect, vi } from 'vitest'
vi.mock('../frontend/src/app/services.js', () => ({
  authService: { isAuthenticated: () => true, getHostUrl: () => 'https://fixture.invalid' },
}))
it('AUDIT-11 tắt cả ba màn hình không tạo vòng lặp redirect', async () => {
  localStorage.setItem('smartcall_logged_in', 'true')
  localStorage.setItem('smartcall_wazo_token', 'fixture')
  localStorage.setItem('smartcall_features_config', JSON.stringify({ calls: false, messages: false, history: false }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const { default: router } = await import('../frontend/src/app/router/index.js')
  await router.push('/calls')
  expect(router.currentRoute.value.path.startsWith('/')).toBe(true)
})

```
