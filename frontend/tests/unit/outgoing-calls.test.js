import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFixture, disposeFixture, deferred } from '../helpers/createFixture.js'

let app
beforeEach(() => {
  app = createFixture()
  app.callState.isRegistered = true
})
afterEach(() => {
  disposeFixture(app)
})

it('gọi đi thành công dùng SDK audio-only và ID cuộc gọi riêng', async () => {
  app.contactService.currentContacts = [
    { id: 'peer', number: '4321', status: 'online', name: 'Fixture' },
  ]
  const result = await app.callService.startCall('4321')
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
    expect((await app.callService.startCall('4321')).success).toBe(false)
    expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  },
)

it('chặn tự gọi và máy lẻ không tìm thấy', async () => {
  expect((await app.callService.startCall('1000')).reason).toBe('SELF_CALL')
  app.contactService.getOrLookupContact = vi.fn(async () => null)
  expect((await app.callService.startCall('4321')).reason).toBe('TARGET_NOT_FOUND')
  expect(app.sdk.Phone.call).not.toHaveBeenCalled()
})

it('khóa quay số còn hiệu lực khi lookup lâu hơn 1200 ms', async () => {
  const pending = deferred()
  app.contactService.getOrLookupContact = vi.fn(() => pending.promise)
  const first = app.callService.startCall('4321')
  vi.advanceTimersByTime(2000)
  expect((await app.callService.startCall('5678')).reason).toBe('THROTTLED')
  pending.resolve({ id: 'peer', number: '4321', status: 'online' })
  expect((await first).success).toBe(true)
})

it('logout khi lookup pending không phát cuộc gọi sau đó', async () => {
  const pending = deferred()
  app.contactService.getOrLookupContact = vi.fn(() => pending.promise)
  const first = app.callService.startCall('4321')
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
  const first = app.callService.startCall('4321')
  await entered.promise
  app.callService.hangupCurrentCall()
  const late = { sipCallId: 'late' }
  pending.resolve(late)
  expect((await first).success).toBe(false)
  expect(app.sdk.Phone.hangup).toHaveBeenCalledWith(late)
  expect(app.callState.activeCall).toBeNull()
})

it('gọi từ nhóm lọc presence thật, còn một người gọi 1-1, không còn ai thì không quay số', async () => {
  const states = ['available', 'talking', 'holding', 'ringing', 'progressing', 'unavailable']
  app.contactService.currentContacts = states.map((state, index) => ({
    uuid: 'peer-' + index,
    number: String(2000 + index),
    status: 'online',
  }))
  states.forEach((state, index) => {
    app.contactService.presences['peer-' + index] = { state: 'available', lines: [{ state }] }
  })
  app.contactService.currentContacts.push(
    { uuid: 'dnd', number: '3000' },
    { uuid: 'offline', number: '3001' },
  )
  app.contactService.presences.dnd = {
    state: 'available',
    do_not_disturb: true,
    lines: [{ state: 'available' }],
  }
  app.contactService.presences.offline = { state: 'offline', lines: [{ state: 'available' }] }
  const start = vi.spyOn(app.callService, 'startCall').mockResolvedValue({ success: true })
  expect(
    (
      await app.groupCallService.startGroupCall([
        '1000',
        ...app.contactService.currentContacts.map((c) => c.number),
        'unknown',
        '2000',
      ])
    ).success,
  ).toBe(true)
  expect(start).toHaveBeenCalledExactlyOnceWith('2000', {})
  expect(app.groupCallService.state.isGroupCall).toBe(false)
  app.contactService.presences['peer-0'] = { state: 'offline' }
  expect((await app.groupCallService.startGroupCall(['2000', '2001'])).reason).toBe(
    'NO_AVAILABLE_TARGETS',
  )
  expect(start).toHaveBeenCalledTimes(1)
})

it('còn hai người rảnh thì giữ luồng nhóm và danh sách mời chỉ gồm người khả dụng', async () => {
  vi.spyOn(app.contactService, 'isContactAvailableForCall').mockImplementation((ext) =>
    ['2000', '2001'].includes(ext),
  )
  const start = vi.spyOn(app.callService, 'startCall').mockResolvedValue({ success: true })
  vi.spyOn(app.groupCallService, 'broadcastGroupStateViaPresence').mockImplementation(() => {})
  expect(
    (await app.groupCallService.startGroupCall(['2000', '2001', '3000', '2000', '1000'])).success,
  ).toBe(true)
  expect(app.groupCallService.state.groupParticipantExtensions).toEqual(['1000', '2000', '2001'])
  expect(app.groupCallService.state.isGroupHost).toBe(true)
  expect(start).toHaveBeenCalledWith(
    '2000',
    expect.objectContaining({ isGroupCall: true, isGroupHost: true }),
  )
})

it('SIP chưa đăng ký không phát call hay bật chuông chờ', async () => {
  app.callState.isRegistered = false
  const ringback = vi.spyOn(app.callService.callToneService, 'startRingbackTone')
  expect((await app.callService.startCall('4321')).reason).toBe('SIP_NOT_READY')
  expect(app.sdk.Phone.call).not.toHaveBeenCalled()
  expect(ringback).not.toHaveBeenCalled()
  expect(app.callState.activeCall).toBeNull()
})
