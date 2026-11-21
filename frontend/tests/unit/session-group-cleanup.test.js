import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'

let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => disposeFixture(app))

it('host bị thu hồi: gửi DELETE snapshot trước khi xóa token, không chờ ACK mới dọn UI', async () => {
  const pending = deferred(),
    requests = []
  const group = app.groupCallService.state
  Object.assign(group, {
    isGroupCall: true,
    isGroupHost: true,
    activeAdhocConferenceId: 'old-conference',
  })
  for (const id of ['b', 'c', 'd']) group.extensionToWazoCallIdMap.set(id, id + '-call')
  app.callService.currentCallSession = { sipCallId: 'primary' }
  app.callState.activeCall = { callId: 'old', number: '2000', status: 'connected' }
  fetch.mockImplementation(async (url, options) => {
    requests.push({ url, options })
    await pending.promise
    return response({}, 204)
  })
  app.authService.handleSessionRevocation()
  expect(app.authService.isAuthenticated()).toBe(false)
  expect(app.callState.activeCall).toBeNull()
  expect(requests.filter((r) => r.options.method === 'DELETE')).toHaveLength(4)
  expect(requests.every((r) => r.options.headers['X-Auth-Token'] === 'fixture-token')).toBe(true)
  expect(app.sdk.Phone.hangup).toHaveBeenCalledWith(
    expect.objectContaining({ sipCallId: 'primary' }),
  )
  localStorage.setItem('smartcall_wazo_token', 'new-token')
  pending.resolve()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(app.callState.activeCall).toBeNull()
  expect(group.isGroupCall).toBe(false)
})

it('phiên mới giải tán nhóm do mình host trước khi revoke; bridge thường/non-host 404 không cúp nhánh', async () => {
  const requests = []
  fetch.mockImplementation(async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' })
    if (url.endsWith('/sessions'))
      return response({ items: [{ uuid: 'current' }, { uuid: 'old' }] })
    if (url.endsWith('/users/me/calls'))
      return response({ items: [{ call_id: 'host', bridges: ['group', 'normal', 'group'] }] })
    if (url.endsWith('/tokens')) return response({ items: [] })
    return response({}, url.endsWith('/normal') ? 404 : 204)
  })
  await app.authService.revokeOtherDeviceSessions('a', 'current', 'web-new')
  const conference = requests.findIndex(
    (r) => r.method === 'DELETE' && r.url.endsWith('/adhoc/group'),
  )
  const session = requests.findIndex(
    (r) => r.method === 'DELETE' && r.url.endsWith('/sessions/old'),
  )
  expect(conference).toBeGreaterThanOrEqual(0)
  expect(session).toBeGreaterThan(conference)
  expect(requests.filter((r) => r.url.endsWith('/adhoc/group'))).toHaveLength(1)
  expect(requests.some((r) => r.method === 'DELETE' && r.url.includes('/users/me/calls/'))).toBe(
    false,
  )
})

it('không dọn conference khi thiết bị hiện tại đã có cuộc gọi mới; lỗi API không báo cleanup thành công', async () => {
  app.callService.currentCallSession = { sipCallId: 'new' }
  expect(await app.callControlApi.endPreviousHostedConferences()).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  app.callService.currentCallSession = null
  fetch.mockResolvedValue(response({}, 403))
  expect(await app.callControlApi.endPreviousHostedConferences()).toBe(false)
})

it('logout thành viên không giải tán hội nghị của host', async () => {
  Object.assign(app.groupCallService.state, {
    isGroupCall: true,
    isGroupHost: false,
    activeAdhocConferenceId: 'host-conference',
  })
  app.callService.currentCallSession = { sipCallId: 'member' }
  app.callState.activeCall = { callId: 'member', number: '2000', status: 'connected' }
  app.authService.handleSessionRevocation()
  expect(fetch).not.toHaveBeenCalled()
  expect(app.sdk.Phone.hangup).toHaveBeenCalled()
  expect(app.callState.activeCall).toBeNull()
})

it('token cũ đã 401: token mới vẫn dọn hội nghị còn tồn tại rồi mới thu hồi session cũ', async () => {
  Object.assign(app.groupCallService.state, {
    isGroupCall: true,
    isGroupHost: true,
    activeAdhocConferenceId: 'group',
  })
  app.callState.activeCall = { callId: 'old', number: '2000', status: 'connected' }
  fetch.mockResolvedValue(response({}, 401))
  app.authService.handleSessionRevocation()
  for (let i = 0; i < 20; i++) await Promise.resolve()
  let alive = true
  app.authService.session = { token: 'new-token', uuid: 'a' }
  app.authService.isSessionRevoked = false
  localStorage.setItem('smartcall_user_uuid', 'a')
  fetch.mockImplementation(async (url, options = {}) => {
    if (url.endsWith('/sessions'))
      return response({ items: [{ uuid: 'old' }, { uuid: 'current' }] })
    if (url.endsWith('/users/me/calls')) return response({ items: [{ bridges: ['group'] }] })
    if (url.endsWith('/adhoc/group')) {
      expect(options.headers['X-Auth-Token']).toBe('new-token')
      alive = false
      return response({}, 204)
    }
    if (url.endsWith('/sessions/old')) expect(alive).toBe(false)
    return response({ items: [] })
  })
  await app.authService.revokeOtherDeviceSessions('a', 'current', 'web-new')
  expect(alive).toBe(false)
})
