import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => disposeFixture(app))
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function prepareLogin() {
  app.authService.synchronizeUserProfile = vi.fn(async () => {})
  app.historyService.reload = vi.fn(async () => [])
  app.eventConnection.connect = vi.fn()
  app.callService.connect = vi.fn(async () => true)
}
it('AUDIT-09 timeout không cho SDK cũ đè lần đăng nhập mới, kể cả trong thời gian cleanup', async () => {
  prepareLogin()
  const old = deferred(),
    started = deferred(),
    cleanup = deferred()
  app.sdk.Auth.logIn
    .mockImplementationOnce(async () => {
      started.resolve()
      await old.promise
      app.sdk.Auth.session = { token: 'old-token', uuid: 'old' }
      return app.sdk.Auth.session
    })
    .mockImplementationOnce(async () => {
      app.sdk.Auth.session = { token: 'new-token', uuid: 'new' }
      return app.sdk.Auth.session
    })
  // Cleanup đầu tiên của phiên fixture thành công; cleanup kết quả SDK muộn còn đang chờ.
  app.sdk.Auth.logout
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(async () => {
      await cleanup.promise
      app.sdk.Auth.session = null
    })
  const first = app.authService.login('old', 'fixture')
  const timedOut = expect(first).rejects.toThrow('quá thời gian')
  await started.promise
  await vi.advanceTimersByTimeAsync(15000)
  await timedOut
  await expect(app.authService.login('new', 'fixture')).rejects.toThrow('chưa kết thúc')
  expect(app.sdk.Auth.logIn).toHaveBeenCalledTimes(1)
  old.resolve()
  await flush()
  await expect(app.authService.login('new', 'fixture')).rejects.toThrow('chưa kết thúc')
  cleanup.resolve()
  await flush()
  await app.authService.login('new', 'fixture')
  expect(app.sdk.Auth.session.uuid).toBe('new')
  expect(app.authService.getToken()).toBe('new-token')
})
it('logout khi SDK đang xác thực dọn cả session nội bộ trả muộn', async () => {
  prepareLogin()
  const pending = deferred(),
    started = deferred()
  app.sdk.Auth.logIn.mockImplementation(async () => {
    started.resolve()
    await pending.promise
    app.sdk.Auth.session = { uuid: 'late', token: 'late-token' }
    return app.sdk.Auth.session
  })
  app.sdk.Auth.logout.mockImplementation(async () => {
    app.sdk.Auth.session = null
  })
  const loggingIn = app.authService.login('late', 'fixture')
  const stale = expect(loggingIn).rejects.toMatchObject({ name: 'StaleSessionError' })
  await started.promise
  const cleanup = app.authService.logout()
  pending.resolve()
  await stale
  await cleanup
  expect(app.sdk.Auth.session).toBeNull()
  expect(app.authService.isAuthenticated()).toBe(false)
})
it('validateToken cũng giữ khóa tới khi SDK kết thúc sau timeout', async () => {
  const pending = deferred(),
    started = deferred()
  app.authService.session = null
  app.sdk.Auth.validateToken.mockImplementation(async () => {
    started.resolve()
    await pending.promise
    app.sdk.Auth.session = { uuid: 'a', token: 'old' }
    return app.sdk.Auth.session
  })
  app.sdk.Auth.logout.mockImplementation(async () => {
    app.sdk.Auth.session = null
  })
  const restoring = app.authService.restoreSession()
  await started.promise
  await vi.advanceTimersByTimeAsync(15000)
  expect(await restoring).toBe(false)
  await expect(app.authService.login('next', 'fixture')).rejects.toThrow('chưa kết thúc')
  pending.resolve()
  await flush()
  await app.authService.sdkCleanupPromise
  expect(app.sdk.Auth.session).toBeNull()
  expect(app.authService.getToken()).toBe('')
})
it('SDK cleanup lỗi thì không khởi tạo hoặc đăng nhập mới trên state chưa an toàn', async () => {
  app.sdk.Auth.logout.mockRejectedValue(new Error('cleanup rejected'))
  await expect(app.authService.login('next', 'fixture')).rejects.toThrow('tải lại trang')
  expect(app.sdk.Auth.logIn).not.toHaveBeenCalled()
  expect(app.sdk.Auth.init).not.toHaveBeenCalled()
})
it('AUDIT-04 thu hồi phiên xóa token/cache, abort request và chặn body trả muộn', async () => {
  const pending = deferred()
  fetch.mockImplementation(() => pending.promise)
  app.chatService.rooms = [{ id: 'r', messages: [] }]
  app.contactService.currentContacts = [{ uuid: 'peer' }]
  app.historyService.localHistory = [{ id: 'private' }]
  app.recordingService._blobUrls.set('private', 'blob:private')
  app.callState.callNotice = 'Thông tin phiên cũ'
  const loading = app.chatService.getRoomMessages('r')
  const signal = fetch.mock.calls[0][1].signal
  app.authService.startSessionHealthCheck()
  app.authService.handleSessionRevocation()
  expect(signal.aborted).toBe(true)
  expect(app.authService.isAuthenticated()).toBe(false)
  expect(app.authService.getToken()).toBe('')
  expect(app.authService.session).toBeNull()
  expect(app.authService.isSessionRevoked).toBe(true)
  expect(app.authService.sessionHealthTimer).toBeNull()
  expect(app.userSessionState.userUuid).toBe('')
  expect(app.contactService.currentContacts).toEqual([])
  expect(app.historyService.localHistory).toEqual([])
  expect(app.recordingService._blobUrls.size).toBe(0)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private')
  expect(app.callState.callNotice).toBeNull()
  pending.resolve(
    response({ items: [{ uuid: 'private', user_uuid: 'peer', content: 'Không được xuất hiện' }] }),
  )
  await loading
  expect(app.chatService.rooms).toEqual([])
  await app.authService.sdkCleanupPromise
})
it('thu hồi lặp không nhân thông báo và disconnect xóa socket/retry', async () => {
  const close = vi.fn()
  app.eventConnection.socket = {
    close,
    onopen: vi.fn(),
    onmessage: vi.fn(),
    onclose: vi.fn(),
    onerror: vi.fn(),
  }
  app.eventConnection.retryTimer = setTimeout(() => app.eventConnection.connect(), 5000)
  const kicked = vi.fn()
  window.addEventListener('smartcall-session-kicked', kicked)
  try {
    app.authService.handleSessionRevocation()
    app.authService.handleSessionRevocation()
    expect(kicked).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(app.eventConnection.socket).toBeNull()
    expect(app.eventConnection.retryTimer).toBeNull()
    await vi.advanceTimersByTimeAsync(10000)
    expect(app.authService.getToken()).toBe('')
    await expect(app.callService.connect()).rejects.toThrow('đăng nhập')
  } finally {
    window.removeEventListener('smartcall-session-kicked', kicked)
  }
})

it('lỗi đóng socket không ngăn xóa credential và định danh SIP cũ', async () => {
  localStorage.setItem('smartcall_sip_user', 'old-extension')
  app.eventConnection.socket = {
    close: () => {
      throw new Error('socket close failed')
    },
  }
  expect(() => app.authService.handleSessionRevocation()).not.toThrow()
  expect(app.authService.getToken()).toBe('')
  expect(app.authService.getCurrentExtension()).toBe('')
  expect(app.eventConnection.socket).toBeNull()
  expect(app.chatService.rooms).toEqual([])
  await app.authService.sdkCleanupPromise
})
