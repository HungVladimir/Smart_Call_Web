import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { createFixture, disposeFixture, deferred, response } from '../helpers/createFixture.js'
import {
  captureSessionContext,
  createSessionFetch,
  invalidateSession,
} from '../../src/services/auth/sessionScope.js'
import { EventConnection } from '../../src/services/realtime/wazoEvents.js'

let app
beforeEach(() => {
  app = createFixture()
})
afterEach(() => {
  disposeFixture(app)
})

describe('Phiên và ownership dữ liệu', () => {
  it('không đưa phòng A vào phiên B khi response đến muộn', async () => {
    const pending = deferred()
    fetch.mockImplementation(() => pending.promise)
    app.contactService.currentContacts = [{ uuid: 'peer' }]
    const request = app.chatService.getRooms()
    invalidateSession()
    app.chatService.reset()
    localStorage.setItem('smartcall_user_uuid', 'b')
    pending.resolve(response({ items: [{ uuid: 'private-a', users: ['a', 'peer'] }] }))
    await request
    expect(app.chatService.rooms).toHaveLength(0)
  })

  it('kiểm tra lại phiên sau khi đọc response body', async () => {
    const body = deferred()
    fetch.mockResolvedValue({ ...response(), json: () => body.promise })
    const result = await createSessionFetch(captureSessionContext())('/fixture')
    const reading = result.json()
    invalidateSession()
    body.resolve({ secret: 'old' })
    await expect(reading).rejects.toMatchObject({ name: 'StaleSessionError' })
  })

  it('không tạo phòng dự phòng sau lookup thuộc phiên cũ', async () => {
    const pending = deferred()
    app.contactService.resolveUserUuid = vi.fn(() => pending.promise)
    const request = app.chatService.getOrCreateDirectRoom('4321', 'Fixture')
    invalidateSession()
    localStorage.setItem('smartcall_user_uuid', 'b')
    pending.resolve('peer')
    await expect(request).rejects.toMatchObject({ name: 'StaleSessionError' })
    expect(app.chatService.rooms).toHaveLength(0)
  })

  it('failure của force refresh cũ không xóa CDR của phiên mới', async () => {
    const pending = deferred()
    fetch.mockImplementation(() => pending.promise)
    const request = app.historyService.getHistory({ forceRefresh: true })
    invalidateSession()
    localStorage.setItem('smartcall_user_uuid', 'b')
    app.historyService.localHistory = [{ id: 'b' }]
    pending.resolve(response({ items: [] }))
    await request
    expect(app.historyService.localHistory[0].id).toBe('b')
  })
})

describe('Quyền chat và xác nhận API', () => {
  it('tin thường không được thực thi như lệnh đóng nhóm', () => {
    app.chatService.rooms = [
      { id: 'r', adminUuid: 'admin', adminVerified: true, messages: [], isDirect: false },
    ]
    app.chatService.handleIncomingMessage({
      room_uuid: 'r',
      user_uuid: 'ordinary',
      content: '[SYSTEM:ROOM_CLOSED]',
    })
    expect(app.chatService.rooms).toHaveLength(1)
    app.chatService.handleIncomingMessage({
      room_uuid: 'r',
      user_uuid: 'admin',
      content: '[SYSTEM:ROOM_CLOSED]',
    })
    expect(app.chatService.rooms).toHaveLength(0)
  })

  it('cold load giữ nhóm đã đóng ở trạng thái ẩn', async () => {
    app.contactService.currentContacts = [{}]
    fetch.mockImplementation(async (url) =>
      response(
        url.includes('/messages?')
          ? {
              items: [
                {
                  uuid: 'm',
                  user_uuid: 'admin',
                  content: '[SYSTEM:ROOM_CLOSED]',
                  created_at: '2026-11-19T00:00:00Z',
                },
              ],
            }
          : { items: [{ uuid: 'r', creator_uuid: 'admin', users: ['a', 'b', 'c'] }] },
      ),
    )
    expect(await app.chatService.getRooms()).toHaveLength(0)
  })

  it('command xóa thất bại giữ nguyên nhóm', async () => {
    app.chatService.rooms = [
      { id: 'r', adminUuid: 'a', adminVerified: true, messages: [], isDirect: false },
    ]
    fetch.mockResolvedValue(response({}, 500))
    await expect(app.chatService.deleteRoom('r')).rejects.toThrow()
    expect(app.chatService.rooms).toHaveLength(1)
  })

  it('không tái tạo nhóm để thay thành viên khi chưa có API an toàn', async () => {
    app.chatService.rooms = [{ id: 'r', messages: [] }]
    await expect(app.chatService.addMembersToGroup('r', ['b', 'c'])).rejects.toThrow()
    await expect(app.chatService.removeMemberFromGroup('r', 'b')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(app.chatService.rooms).toHaveLength(1)
  })
})

describe('Cuộc gọi và hội nghị', () => {
  it('nghe máy bị từ chối không đặt connected hoặc chạy đồng hồ', async () => {
    app.sdk.Phone.accept.mockRejectedValue(new Error('rejected'))
    app.callState.incomingCall = { number: '4321', rawSession: { sipCallId: 'incoming' } }
    expect(await app.callService.acceptIncomingCall()).toBe(false)
    expect(app.callState.activeCall).toBeNull()
    expect(app.callService._durationInterval).toBeNull()
  })

  it('đang chờ accept có trạng thái answering', async () => {
    const pending = deferred()
    app.sdk.Phone.accept.mockImplementation(() => pending.promise)
    app.callState.incomingCall = { number: '4321', rawSession: { sipCallId: 'incoming' } }
    const request = app.callService.acceptIncomingCall()
    expect(app.callState.activeCall.status).toBe('answering')
    expect(app.callState.activeCall.startTime).toBeNull()
    pending.resolve('accepted')
    expect(await request).toBe(true)
    expect(app.callState.activeCall.status).toBe('answering')
  })

  it('conference tạo muộn không hồi sinh sau khi cúp', async () => {
    const pending = deferred(),
      started = deferred()
    app.groupCallService.state.isGroupCall = app.groupCallService.state.isGroupHost = true
    app.callService.currentCallSession = { sipCallId: 's' }
    app.callState.activeCall = { callId: 'old', number: 'peer', status: 'connected' }
    app.groupCallService.state.extensionToWazoCallIdMap.set('x', 'px')
    app.groupCallService.state.extensionToWazoCallIdMap.set('y', 'py')
    app.callControlApi.listActiveCalls = vi.fn(async () => [
      { id: 'host', sip_call_id: 's', talking_to: {} },
    ])
    app.callControlApi.createConference = vi.fn(() => {
      started.resolve()
      return pending.promise
    })
    app.callControlApi.deleteConference = vi.fn(async () => true)
    const request = app.groupCallService.synchronizeActiveCalls()
    await started.promise
    app.callService.finalizeCallTermination('ended', null, true)
    pending.resolve('late-conf')
    await request
    expect(app.groupCallService.state.activeAdhocConferenceId).toBe('')
    expect(app.callControlApi.deleteConference).toHaveBeenCalledWith('late-conf')
  })

  it('merge lỗi vẫn được thử lại, chỉ commit sau ACK', async () => {
    Object.assign(app.groupCallService.state, {
      isGroupCall: true,
      isGroupHost: true,
      activeAdhocConferenceId: 'conf',
    })
    app.callService.currentCallSession = { sipCallId: 's' }
    app.callState.activeCall = { number: 'peer', status: 'connected' }
    app.groupCallService.state.extensionToWazoCallIdMap.set('member', 'p')
    app.callControlApi.listActiveCalls = vi.fn(async () => [
      { id: 'host', sip_call_id: 's', talking_to: {} },
    ])
    app.callControlApi.addConferenceParticipant = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    await app.groupCallService.synchronizeActiveCalls()
    expect(app.groupCallService.state.mergedCallIds.has('p')).toBe(false)
    await app.groupCallService.synchronizeActiveCalls()
    expect(app.groupCallService.state.mergedCallIds.has('p')).toBe(true)
  })

  it('nhánh phụ nghe trước bắt đầu đồng hồ và progress không hạ connected', () => {
    app.callService.attachPhoneListeners()
    Object.assign(app.groupCallService.state, { isGroupCall: true, isGroupHost: true })
    const primary = { sipCallId: 'p' },
      secondary = { sipCallId: 's' }
    app.callService.currentCallSession = primary
    app.groupCallService.state.secondaryCallSessions.set('member', secondary)
    app.groupCallService.syncActiveCallsToAdhocConference = vi.fn()
    app.callState.activeCall = {
      session: primary,
      number: 'peer',
      status: 'ringing',
      startTime: null,
      duration: 0,
    }
    app.callService._onCallAcceptedHandler(secondary)
    app.callService._onProgressHandler(primary)
    expect(app.callState.activeCall.status).toBe('connected')
    expect(app.callState.activeCall.startTime).toBeTruthy()
    expect(app.callService._durationInterval).toBeTruthy()
  })

  it('dialing và Map nhánh phụ cập nhật computed thực', () => {
    const dialing = computed(() => app.callService.isDialing)
    expect(dialing.value).toBe(false)
    app.callService.isDialing = true
    expect(dialing.value).toBe(true)
    const count = computed(() => app.groupCallService.state.secondaryCallSessions.size)
    app.groupCallService.state.secondaryCallSessions.set('4321', {})
    expect(count.value).toBe(1)
  })

  it('nhánh SDK trả sau hangup bị cúp và không đưa trở lại nhóm', async () => {
    const pending = deferred()
    app.callState.activeCall = { callId: 'old', number: 'peer', status: 'connected' }
    Object.assign(app.groupCallService.state, { isGroupCall: true, isGroupHost: true })
    app.contactService.isContactAvailableForCall = vi.fn(() => true)
    app.groupCallService.broadcastGroupStateViaPresence = vi.fn()
    app.groupCallService.broadcastNoticeToGroup = vi.fn()
    app.sdk.Phone.call.mockImplementation(() => pending.promise)
    const request = app.groupCallService.addParticipantsToGroupCall(['4321'])
    app.callService.finalizeCallTermination('ended', null, true)
    const late = { sipCallId: 'late' }
    pending.resolve(late)
    await request
    expect(app.sdk.Phone.hangup).toHaveBeenCalledWith(late)
    expect(app.groupCallService.state.secondaryCallSessions.size).toBe(0)
    expect(app.callState.activeCall).toBeNull()
  })
})

describe('Ghi âm và media', () => {
  it('HTTP500 khi stop giữ state để thử lại; HTTP204 mới dừng', async () => {
    Object.assign(app.recordingState, { isRecording: true, currentCallId: 'server-id' })
    fetch.mockResolvedValue(response({}, 500))
    await expect(app.recordingService.stopRecording()).rejects.toThrow()
    expect(app.recordingState.isRecording).toBe(true)
    expect(app.recordingState.isStopping).toBe(false)
    fetch.mockResolvedValue(response({}, 204))
    await app.recordingService.stopRecording()
    expect(app.recordingState.isRecording).toBe(false)
  })

  it('start trả muộn sau hủy phải được stop, không bật state', async () => {
    const pending = deferred()
    fetch.mockImplementation((url) =>
      url.endsWith('/start') ? pending.promise : Promise.resolve(response({}, 204)),
    )
    const request = app.recordingService.startRecording('server-id')
    app.recordingService.cancelPendingStart()
    pending.resolve(response({}, 204))
    expect(await request).toBe(false)
    expect(app.recordingState.isRecording).toBe(false)
    expect(fetch.mock.calls[1][0]).toMatch(/\/stop$/)
  })

  it('cache audio phân biệt owner và được revoke khi xóa phiên', async () => {
    let count = 0
    URL.createObjectURL.mockImplementation(() => 'blob:' + ++count)
    fetch.mockResolvedValue(response())
    const call = { id: 'cdr', recordingUuid: 'recording' }
    expect(await app.recordingService.getAudioUrlForCall(call)).toBe('blob:1')
    localStorage.setItem('smartcall_user_uuid', 'b')
    expect(await app.recordingService.getAudioUrlForCall(call)).toBe('blob:2')
    app.recordingService.clearSessionCache()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('thiết bị đã chọn đi vào media constraints và output của SDK', async () => {
    localStorage.setItem('smartcall_selected_mic', 'mic-1')
    localStorage.setItem('smartcall_selected_speaker', 'speaker-1')
    app.callState.activeCall = { status: 'connected' }
    app.sdk.Phone.phone = {
      setMediaConstraints: vi.fn(),
      changeAudioInputDevice: vi.fn(),
      changeAudioDevice: vi.fn(),
    }
    await app.phoneAdapter.applyAudioDevices()
    expect(app.sdk.Phone.phone.setMediaConstraints).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'mic-1' } },
      video: false,
    })
    expect(app.sdk.Phone.phone.changeAudioDevice).toHaveBeenCalledWith('speaker-1')
  })
})

describe('Transport độc lập nghiệp vụ', () => {
  it('đóng socket hủy retry và không kết nối lại sau logout', async () => {
    const sockets = []
    class Socket {
      constructor(url) {
        this.url = url
        this.send = vi.fn()
        this.close = vi.fn()
        sockets.push(this)
      }
    }
    vi.stubGlobal('WebSocket', Socket)
    const connection = new EventConnection({ authService: app.authService, onEnvelope: vi.fn() })
    connection.connect()
    sockets[0].onopen()
    expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({ op: 'start' }))
    await sockets[0].onclose({ code: 1006, reason: '' })
    connection.disconnect()
    vi.advanceTimersByTime(10000)
    expect(sockets).toHaveLength(1)
  })
})
