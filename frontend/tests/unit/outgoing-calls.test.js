import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFixture, disposeFixture, deferred } from '../helpers/createFixture.js'

let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => {
  disposeFixture(app)
})

it('gọi đi thành công dùng SDK audio-only và ID cuộc gọi riêng', async () => {
  app.contactService.currentContacts = [
    { id: 'peer', number: '4321', status: 'online', name: 'Fixture' },
  ]
  const result = await app.callController.startCall('4321')
  expect(result.success).toBe(true)
  expect(app.sdk.Phone.call).toHaveBeenCalledWith('4321', false)
  expect(app.callState.activeCall.number).toBe('4321')
  expect(app.callState.activeCall.callId).toMatch(/^call-/)
  expect(app.callState.activeCall.status).toBe('ringing')
})

it.each(['busy', 'talking', 'holding', 'ringing', 'dnd', 'offline', 'unavailable'])(
  'policy chặn trạng thái %s trước khi chạm SDK',
  async (status) => {
    app.contactService.currentContacts = [{ id: 'peer', number: '4321', status }]
    expect((await app.callController.startCall('4321')).success).toBe(false)
    expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  },
)

it('chặn tự gọi và máy lẻ không tìm thấy', async () => {
  expect((await app.callController.startCall('1000')).reason).toBe('SELF_CALL')
  app.contactService.getOrLookupContact = vi.fn(async () => null)
  expect((await app.callController.startCall('4321')).reason).toBe('TARGET_NOT_FOUND')
  expect(app.sdk.Phone.call).not.toHaveBeenCalled()
})

it('khóa quay số còn hiệu lực khi lookup lâu hơn 1200 ms', async () => {
  const pending = deferred()
  app.contactService.getOrLookupContact = vi.fn(() => pending.promise)
  const first = app.callController.startCall('4321')
  vi.advanceTimersByTime(2000)
  expect((await app.callController.startCall('5678')).reason).toBe('THROTTLED')
  pending.resolve({ id: 'peer', number: '4321', status: 'online' })
  expect((await first).success).toBe(true)
})

it('logout khi lookup pending không phát cuộc gọi sau đó', async () => {
  const pending = deferred()
  app.contactService.getOrLookupContact = vi.fn(() => pending.promise)
  const first = app.callController.startCall('4321')
  app.authService.logout()
  pending.resolve({ number: '4321', status: 'online' })
  expect((await first).reason).toBe('CANCELED')
  expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  expect(app.callState.activeCall).toBeNull()
})

it('cúp lúc SDK pending cúp cả session đến muộn', async () => {
  app.contactService.currentContacts = [{ id: 'peer', number: '4321', status: 'online' }]
  const pending = deferred(),
    entered = deferred()
  app.sdk.Phone.call.mockImplementation(() => {
    entered.resolve()
    return pending.promise
  })
  const first = app.callController.startCall('4321')
  await entered.promise
  app.callController.hangupCurrentCall()
  const late = { sipCallId: 'late' }
  pending.resolve(late)
  expect((await first).success).toBe(false)
  expect(app.sdk.Phone.hangup).toHaveBeenCalledWith(late)
  expect(app.callState.activeCall).toBeNull()
})
