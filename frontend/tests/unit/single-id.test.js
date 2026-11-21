import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
import { userSessionState } from '../../src/state/sessionState.js'

let app
const profile = {
  name: 'Họ Đệm Tên',
  email: 'employee@samsung.com',
  department: 'Bộ phận',
  employee_id: 'EP1',
}

/** Tạo phản hồi backend và SDK ở ranh giới, giữ luồng AuthService/gate thật. */
function prepare() {
  const value = {
    token: 'sso-token',
    refresh_token: 'sso-refresh',
    user_uuid: 'peer',
    host: 'https://wazo.fixture',
    username: 'sso_fixture',
    profile,
  }
  vi.spyOn(app.authService, 'revokeOtherDeviceSessions').mockResolvedValue()
  vi.spyOn(app.authService, 'startSessionHealthCheck').mockImplementation(() => {})
  vi.spyOn(app.callService, 'connect').mockResolvedValue()
  vi.spyOn(app.eventConnection, 'connect').mockImplementation(() => {})
  vi.spyOn(app.historyService, 'reload').mockResolvedValue()
  app.sdk.Auth.validateToken.mockResolvedValue({
    uuid: 'peer',
    token: 'sso-token',
    refreshToken: 'sso-refresh',
    sessionUuid: 'sso-session',
    primaryNumber: () => '2001',
  })
  fetch.mockImplementation(async (url) => {
    if (url === '/api/auth/user_info') return response({ profile, csrf_token: 'csrf' })
    if (url === '/api/auth/wazo-session') return response(value)
    if (url === '/api/auth/logout') return response({ status: 'logged_out' })
    if (url.endsWith('/api/confd/1.1/users/peer'))
      return response({ uuid: 'peer', firstname: 'Tên Wazo cũ', department: 'Bộ phận cũ' })
    throw new Error('Unexpected fixture URL')
  })
  return value
}

beforeEach(() => {
  app = createFixture()
})
afterEach(() => {
  disposeFixture(app)
})

it('Single ID dùng token user, cùng bootstrap SDK/WebSocket/SIP và ưu tiên hồ sơ IdP', async () => {
  prepare()
  await app.authService.getSingleIdProfile()
  await app.authService.completeSingleIdLogin('csrf')
  expect(app.sdk.Auth.logIn).not.toHaveBeenCalled()
  expect(app.sdk.Auth.validateToken).toHaveBeenCalledWith('sso-token', 'sso-refresh')
  expect(app.callService.connect).toHaveBeenCalled()
  expect(app.eventConnection.connect).toHaveBeenCalled()
  expect(userSessionState.userUuid).toBe('peer')
  expect(userSessionState.extension).toBe('2001')
  expect(userSessionState.displayName).toBe(profile.name)
  expect(userSessionState.department).toBe(profile.department)
  const request = fetch.mock.calls.find(([url]) => url === '/api/auth/wazo-session')
  expect(request[1].headers).toEqual(
    expect.objectContaining({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf' }),
  )
  expect(JSON.parse(request[1].body)).toEqual({ client_id: expect.stringMatching(/^web_/) })
  expect(localStorage.getItem('smartcall_auth_method')).toBe('singleid')
  expect(Object.values(localStorage).join(' ')).not.toContain(profile.employee_id)
})

it('backend không có credential Wazo thì giữ lỗi cấu hình, không tạo session SDK giả', async () => {
  prepare()
  fetch.mockResolvedValue(
    response({ detail: { code: 'WAZO_NOT_CONFIGURED', message: 'Cần cấu hình Wazo' } }, 503),
  )
  await expect(app.authService.completeSingleIdLogin('csrf')).rejects.toMatchObject({
    code: 'WAZO_NOT_CONFIGURED',
  })
  expect(app.sdk.Auth.validateToken).not.toHaveBeenCalled()
  expect(localStorage.getItem('smartcall_wazo_token')).toBeNull()
  expect(app.callService.connect).not.toHaveBeenCalled()
})

it('SDK trả sai UUID thì dọn phiên, không công bố đăng nhập', async () => {
  prepare()
  app.sdk.Auth.validateToken.mockResolvedValue({ token: 'wrong', uuid: 'other' })
  await expect(app.authService.completeSingleIdLogin('csrf')).rejects.toThrow('không khớp')
  expect(app.authService.session).toBeNull()
  expect(localStorage.getItem('smartcall_wazo_token')).toBeNull()
  expect(app.callService.connect).not.toHaveBeenCalled()
})

it('logout khi backend đang cấp phát không cho response muộn khởi tạo SDK', async () => {
  prepare()
  const pending = deferred()
  fetch.mockImplementation(async () => {
    await pending.promise
    return response({ token: 'late', user_uuid: 'peer', host: 'https://wazo.fixture' })
  })
  const command = app.authService.completeSingleIdLogin('csrf')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
  app.authService.logout({ preserveSingleId: true })
  pending.resolve()
  await expect(command).rejects.toThrow('Phiên')
  expect(app.sdk.Auth.validateToken).not.toHaveBeenCalled()
  expect(app.authService.session).toBeNull()
})

it('logout hủy cookie backend kể cả khi scope SDK đã bị vô hiệu hóa', async () => {
  prepare()
  await app.authService.getSingleIdProfile()
  localStorage.setItem('smartcall_auth_method', 'singleid')
  app.authService.logout()
  await vi.waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(true),
  )
  expect(app.authService.singleIdProfile).toBeNull()
})

it('logout SSO yêu cầu handoff qua CSRF rồi điều hướng cửa sổ; không redirect URL tùy ý', async () => {
  prepare()
  app.authService.singleIdCsrf = 'csrf'
  fetch.mockResolvedValue(response({ redirect_url: 'https://other.fixture' }))
  await expect(app.authService.logoutSingleId()).rejects.toThrow('không hợp lệ')
  const request = fetch.mock.calls.find(([url]) => url === '/api/auth/idp-logout')
  expect(request[1].headers['X-CSRF-Token']).toBe('csrf')
  expect(app.authService.session).not.toBeNull()
})

it('logout SSO thành công dọn SDK và điều hướng tới handoff cùng origin', async () => {
  prepare()
  app.authService.singleIdCsrf = 'csrf'
  fetch.mockResolvedValue(response({ redirect_url: '/api/auth/idp-logout/continue' }))
  const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  await app.authService.logoutSingleId()
  expect(navigate).toHaveBeenCalledWith('/api/auth/idp-logout/continue')
  expect(app.authService.session).toBeNull()
  expect(localStorage.getItem('smartcall_wazo_token')).toBeNull()
})
