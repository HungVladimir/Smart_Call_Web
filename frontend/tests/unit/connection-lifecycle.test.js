import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createFixture, disposeFixture, deferred } from '../helpers/createFixture.js'
import { invalidateSession } from '../../src/services/auth/sessionScope.js'
let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => disposeFixture(app))

it('gộp các lệnh kết nối đồng thời và không bỏ lỡ registered phát ngay', async () => {
  const pending = deferred()
  app.sdk.Phone.connect.mockImplementation(() => {
    app.callService._onRegisteredHandler()
    return pending.promise
  })
  const first = app.callService.connect(),
    second = app.callService.connect()
  expect(app.sdk.Phone.connect).toHaveBeenCalledTimes(1)
  expect(app.callState.isRegistered).toBe(true)
  pending.resolve()
  await Promise.all([first, second])
  await app.callService.connect()
  expect(app.sdk.Phone.connect).toHaveBeenCalledTimes(1)
})

it('callback SDK đã xếp hàng không đăng ký lại SIP sau disconnect', () => {
  app.callService.attachPhoneListeners()
  const lateHandler = app.callService._onRegisteredHandler
  app.callService.disconnect()
  lateHandler()
  expect(app.callState.isRegistered).toBe(false)
})

it('callback của phiên A không sửa trạng thái đăng ký của phiên B', () => {
  app.callService.attachPhoneListeners()
  const lateHandler = app.callService._onUnregisteredHandler
  invalidateSession()
  localStorage.setItem('smartcall_user_uuid', 'b')
  app.callState.isRegistered = true
  lateHandler()
  expect(app.callState.isRegistered).toBe(true)
})

it('kết nối hoàn tất sau disconnect không gắn lại listener', async () => {
  const pending = deferred()
  app.sdk.Phone.connect.mockImplementation(() => pending.promise)
  const connecting = app.callService.connect()
  const rejected = expect(connecting).rejects.toThrow('hủy')
  app.callService.disconnect()
  pending.resolve()
  await rejected
  expect(app.callService.listenersAttached).toBe(false)
})

it('đăng nhập SDK treo được giải phóng sau 15 giây, kết quả muộn không commit token', async () => {
  const pending = deferred()
  app.sdk.Auth.logIn.mockImplementation(() => pending.promise)
  const loggingIn = app.authService.login('fixture', 'fixture-password')
  const rejected = expect(loggingIn).rejects.toThrow('quá thời gian')
  await vi.advanceTimersByTimeAsync(15000)
  await rejected
  pending.resolve({ token: 'late', uuid: 'a' })
  await Promise.resolve()
  expect(localStorage.getItem('smartcall_wazo_token')).toBeNull()
  expect(app.authService.session).toBeNull()
})

it('token khôi phục bị máy chủ từ chối được xóa khỏi trạng thái đăng nhập', async () => {
  app.authService.session = null
  app.sdk.Auth.validateToken.mockResolvedValue(null)
  expect(await app.authService.restoreSession()).toBe(false)
  expect(app.authService.isAuthenticated()).toBe(false)
  expect(localStorage.getItem('smartcall_wazo_token')).toBeNull()
})

it('khôi phục thất bại của phiên A không logout phiên B', async () => {
  const pending = deferred()
  app.authService.session = null
  app.sdk.Auth.validateToken.mockImplementation(() => pending.promise)
  const restoring = app.authService.restoreSession()
  invalidateSession()
  localStorage.setItem('smartcall_user_uuid', 'b')
  localStorage.setItem('smartcall_wazo_token', 'token-b')
  app.authService.session = { uuid: 'b', token: 'token-b' }
  pending.resolve(null)
  await restoring
  expect(app.authService.getToken()).toBe('token-b')
})

it('media ghi âm sử dụng host đã chọn của phiên đăng nhập', async () => {
  app.authService.host = 'https://pbx.fixture.invalid'
  fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'active' }] }) })
  await app.recordingService.getActiveServerCall()
  expect(fetch).toHaveBeenCalledWith(
    'https://pbx.fixture.invalid/api/calld/1.0/users/me/calls',
    expect.any(Object),
  )
})

it('đăng nhập mới chờ SDK logout cũ hoàn tất trước khi gọi Auth.logIn', async () => {
  const cleanup = deferred()
  app.sdk.Auth.logout.mockImplementation(() => cleanup.promise)
  app.sdk.Auth.logIn.mockResolvedValue({ token: 'new', uuid: 'a', primaryNumber: () => '1000' })
  app.authService.synchronizeUserProfile = vi.fn(async () => {})
  app.historyService.reload = vi.fn(async () => [])
  app.eventConnection.connect = vi.fn()
  app.callService.connect = vi.fn(async () => true)
  const loggingIn = app.authService.login('fixture', 'fixture-password')
  await Promise.resolve()
  expect(app.sdk.Auth.logIn).not.toHaveBeenCalled()
  cleanup.resolve()
  await loggingIn
  expect(app.sdk.Auth.logIn).toHaveBeenCalledTimes(1)
})

it('kết nối mới chờ SDK disconnect cũ trước khi mở phone', async () => {
  const cleanup = deferred()
  app.sdk.Phone.disconnect.mockImplementation(() => cleanup.promise)
  app.callService.disconnect()
  const connecting = app.callService.connect()
  expect(app.sdk.Phone.connect).not.toHaveBeenCalled()
  cleanup.resolve()
  await connecting
  expect(app.sdk.Phone.connect).toHaveBeenCalledTimes(1)
})
