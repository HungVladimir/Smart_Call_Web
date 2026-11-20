import { callState } from '../../state/callState.js'
import { userSessionState } from '../../state/sessionState.js'
import { captureSessionContext, isSessionContextCurrent } from '../auth/sessionScope.js'
import { logger } from '../common/loggerService.js'

/** Tạo callback có tên; CallService sở hữu đăng ký/gỡ để không nhân đôi listeners. */
export function createPhoneEventHandlers(callService) {
  const context = captureSessionContext()
  const generation = callService.listenerGeneration
  const handlers = {
    _onRegisteredHandler: createRegisteredHandler(callService),
    _onUnregisteredHandler: createUnregisteredHandler(callService),
    _onProgressHandler: createProgressHandler(callService),
    _onCallIncomingHandler: createCallIncomingHandler(callService),
    _onCallAcceptedHandler: createCallAcceptedHandler(callService),
    _onCallEndedHandler: createCallEndedHandler(callService),
    _onCallFailedHandler: createCallFailedHandler(callService),
    _onCallRejectedHandler: createCallRejectedHandler(callService),
    _onCallCanceledHandler: createCallCanceledHandler(callService),
  }
  // Kể cả khi SDK đã đưa callback vào hàng đợi, phiên cũ không được sửa state của phiên mới.
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (...args) => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (generation === callService.listenerGeneration && isSessionContextCurrent(context))
          return handler(...args)
      },
    ]),
  )
}

/** Cập nhật SIP registered và hồ sơ đang dùng. */
function createRegisteredHandler(callService) {
  return () => {
    callState.isRegistered = true
    userSessionState.extension = callService.authService.getCurrentExtension()
    userSessionState.userUuid = callService.authService.getCurrentUserUuid()
    userSessionState.displayName = callService.authService.getCurrentDisplayName()
    logger.success('SIP', '🟢 Wazo WebRTC SIP Phone: Registered thành công!')
    window.dispatchEvent(new CustomEvent('wazo-registered'))
  }
}

/** Đánh dấu mất đăng ký và kiểm chứng phiên trước khi kết nối lại. */
function createUnregisteredHandler(callService) {
  return () => {
    callState.isRegistered = false
    logger.warn('SIP', '🔴 Wazo WebRTC SIP Phone: Unregistered!')
    window.dispatchEvent(new CustomEvent('wazo-unregistered'))

    if (callService.authService.isAuthenticated() && !callService.authService.isSessionRevoked) {
      const reconnectContext = captureSessionContext()
      callService.authService
        .verifySessionHealth()
        .then((isValid) => {
          // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
          // đến muộn sau hủy/đổi phiên.
          if (!isSessionContextCurrent(reconnectContext)) return
          if (!isValid && callService.authService.refreshTokenRevoked) {
            logger.warn(
              'SIP',
              'Phiên SIP bị ngắt do token không còn hợp lệ hoặc phiên đã chuyển sang thiết bị khác!',
            )
            callService.authService.handleSessionRevocation()
            return
          }
          setTimeout(async () => {
            // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ
            // liệu đến muộn sau hủy/đổi phiên.
            if (!isSessionContextCurrent(reconnectContext)) return
            if (
              callService.authService.isAuthenticated() &&
              !callState.isRegistered &&
              !callService.authService.isSessionRevoked
            ) {
              try {
                logger.info('SIP', 'Đang tự động kết nối lại WebRTC Phone sau khi mất đăng ký...')
                await callService.connect()
              } catch (err) {
                logger.warn('SIP', 'Tự động kết nối lại WebRTC Phone thất bại:', err)
              }
            }
          }, 5000)
        })
        .catch((error) =>
          logger.warn('SIP', 'Không thể kiểm tra phiên trước khi kết nối lại:', error),
        )
    }
  }
}

/** Cập nhật đổ chuông nhưng không hạ cuộc gọi đã kết nối. */
function createProgressHandler(callService) {
  return (callSession) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('progress', callSession)) return
    logger.info('CALL', '🔔 Sự kiện Wazo: Đường dây đang đổ chuông (ON_PROGRESS / 180 Ringing)')
    if (callState.activeCall && callState.activeCall.status !== 'connected') {
      callState.activeCall.status = 'ringing'
      callService.callToneService.startRingbackTone()
    }
    window.dispatchEvent(new CustomEvent('wazo-progress', { detail: callSession }))
  }
}

/** Chuẩn hóa cuộc gọi đến và từ chối nhánh xung đột. */
function createCallIncomingHandler(callService) {
  return (callSession) => {
    const ext = callSession?.number || callSession?.callerNumber || callSession?.extension || ''
    logger.info('CALL', `🔔 Cuộc gọi đến từ máy lẻ: ${ext || 'N/A'}`, callSession)

    // Kiểm tra nếu đang có cuộc gọi hoạt động (bận)
    if (
      callState.activeCall ||
      (callState.incomingCall && callState.incomingCall.rawSession !== callSession)
    ) {
      logger.warn('CALL', `Đang bận đàm thoại. Tự động từ chối cuộc gọi đến từ máy lẻ ${ext}`)
      try {
        if (callSession && typeof callSession.reject === 'function') {
          callSession.reject()
        } else {
          callService.rejectSdkCall(callSession)
        }
      } catch (e) {}

      const contact = callService.contactService.findContactByExtension(ext)
      const name = contact?.name || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp')
      const dept = contact?.dept || 'Nội bộ công ty'
      callService.historyService.addRecord({
        name,
        extension: ext,
        dept,
        duration: 0,
        direction: 'inbound',
        status: 'missed',
        answered: false,
      })
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: `📞 Cuộc gọi nhỡ từ ${name} (Máy bận)`, type: 'warning' },
        }),
      )
      return
    }

    callService.currentCallSession = callSession
    const contact = callService.contactService.findContactByExtension(ext)
    const name =
      callSession?.displayName ||
      callSession?.realDisplayName ||
      callSession?.name ||
      contact?.name ||
      (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp')
    const dept = callSession?.dept || contact?.dept || 'Nội bộ công ty'
    const sipHost = (callService.authService.host || '107.126.11.126:9443')
      .replace(/^https?:\/\//, '')
      .split(':')[0]
    const sipUri = callSession?.sipUri || (ext ? `sip:${ext}@${sipHost}` : '')

    callState.incomingCall = {
      rawSession: callSession,
      session: callSession,
      number: ext,
      extension: ext,
      name,
      dept,
      sipUri,
    }

    window.dispatchEvent(new CustomEvent('wazo-incoming', { detail: callSession }))
  }
}

/** Nhận ACK SDK, bắt đầu đồng hồ và gắn media đúng thế hệ. */
function createCallAcceptedHandler(callService) {
  return (callSession) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('accepted', callSession)) return
    callService.answeredSipIds.add(callService.getSipSessionId(callSession))
    // Không dựng lại cuộc gọi từ event đến muộn khi cả nhánh active và incoming đã được dọn.
    if (!callState.activeCall && !callState.incomingCall) return
    const acceptedEpoch = callService.callGeneration
    const acceptedContext = captureSessionContext()
    // 1. Kiểm tra xem session này có phải là nhánh phụ (Secondary Leg) trong cuộc gọi nhóm hay
    // không
    const acceptedSipId =
      callSession?.sipCallId || (callSession?.getId && callSession.getId()) || callSession?.id
    let isSecondaryLeg = false
    let matchedSecExt = null
    for (const [
      secExt,
      secSession,
    ] of callService.groupCallService.state.secondaryCallSessions.entries()) {
      const secSipId =
        secSession?.sipCallId || (secSession?.getId && secSession.getId()) || secSession?.id
      // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
      // đổi state.
      if (
        secSession === callSession ||
        (acceptedSipId && secSipId && String(secSipId) === String(acceptedSipId))
      ) {
        isSecondaryLeg = true
        matchedSecExt = secExt
        break
      }
    }

    // Xử lý riêng cho nhánh phụ (Secondary Leg) trong cuộc gọi nhóm do Host điều phối
    if (
      callService.groupCallService.state.isGroupCall &&
      callService.groupCallService.state.isGroupHost &&
      isSecondaryLeg
    ) {
      logger.success(
        'CALL',
        `🟢 Nhánh phụ [${matchedSecExt || 'N/A'}] đã nghe máy trong cuộc gọi nhóm.`,
      )
      callService.callToneService.stopRingbackTone()
      if (matchedSecExt) {
        callService.groupCallService.state.secondaryCallSessions.set(matchedSecExt, callSession)
        callService.groupCallService.clearParticipantInviteTimeout(matchedSecExt)
      }

      if (callState.incomingCall) {
        callState.incomingCall = null
      }

      if (callState.activeCall) {
        callState.activeCall.status = 'connected'
        if (!callState.activeCall.startTime) {
          callState.activeCall.startTime = Date.now()
          callService.startCallDurationTimer()
        }
        if (!callService.groupCallService.state.activeAdhocConferenceId) {
          const stream = callService.sdk.Phone.getRemoteStream(callSession)
          if (stream) callService.phoneAdapter.playCallAudio(stream)
        }
        // Giữ nguyên thời gian bắt đầu (startTime) của cuộc gọi nhóm đang diễn ra, không reset về
        // 0
        if (!callService.currentCallSession) {
          callService.currentCallSession = callSession
          callState.activeCall.session = callSession
        }
      } else {
        callService.currentCallSession = callSession
        const ext =
          matchedSecExt ||
          callSession?.number ||
          callSession?.callerNumber ||
          callSession?.extension ||
          ''
        const contact = callService.contactService.findContactByExtension(ext)
        callState.activeCall = {
          session: callSession,
          callId: `rec-${Date.now()}`,
          number: ext,
          name: contact?.name || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp'),
          dept: contact?.dept || '',
          direction: 'outbound',
          status: 'connected',
          startTime: Date.now(),
          duration: 0,
          isMuted: false,
          isRecorded: false,
        }
        callService.startCallDurationTimer()
      }

      // Tự động kết nối nhánh phụ vừa nghe máy vào Ad-hoc Conference qua Asterisk ConfBridge
      callService.groupCallService.syncActiveCallsToAdhocConference()

      // Khi đã có ConfBridge, giữ nguyên đường âm thanh của hội nghị.
      window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
      return
    }

    callService.currentCallSession = callSession
    logger.success(
      'CALL',
      '🟢 Sự kiện Wazo: Cuộc gọi đã được kết nối! Đang đàm thoại 2 chiều (Full-Duplex).',
    )
    callService.callToneService.stopRingbackTone()

    if (callState.incomingCall) {
      callState.incomingCall = null
    }

    if (callState.activeCall) {
      callState.activeCall.session = callSession
      callState.activeCall.status = 'connected'
      if (!callState.activeCall.startTime) {
        callState.activeCall.startTime = Date.now()
        callState.activeCall.duration = 0
      }
      if (!callState.activeCall.callId) {
        callState.activeCall.callId = `rec-${Date.now()}`
      }
    } else {
      const ext = callSession?.number || callSession?.callerNumber || callSession?.extension || ''
      const contact = callService.contactService.findContactByExtension(ext)
      callState.activeCall = {
        session: callSession,
        callId: `rec-${Date.now()}`,
        number: ext,
        name: contact?.name || (ext ? `Máy lẻ ${ext}` : 'Đồng nghiệp'),
        dept: contact?.dept || '',
        direction: 'inbound',
        status: 'connected',
        startTime: Date.now(),
        duration: 0,
        isMuted: false,
        isRecorded: false,
      }
    }

    callService.startCallDurationTimer()
    callService.groupCallService.clearPrimaryInviteTimeout()

    // Xóa timer timeout 30s của nhánh phụ nếu đây là nhánh phụ vừa nghe máy
    for (const [
      secExt,
      secSession,
    ] of callService.groupCallService.state.secondaryCallSessions.entries()) {
      const secSipId =
        secSession?.sipCallId || (secSession?.getId && secSession.getId()) || secSession?.id
      // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
      // đổi state.
      if (
        secSession === callSession ||
        (acceptedSipId && secSipId && String(secSipId) === String(acceptedSipId))
      ) {
        callService.groupCallService.clearParticipantInviteTimeout(secExt)
        break
      }
    }

    // Tự động đồng bộ các nhánh vào Ad-hoc Conference nếu đang gọi nhóm
    if (
      callService.groupCallService.state.isGroupCall &&
      callService.groupCallService.state.isGroupHost
    ) {
      setTimeout(() => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (
          acceptedEpoch !== callService.callGeneration ||
          !isSessionContextCurrent(acceptedContext)
        )
          return
        callService.groupCallService.syncActiveCallsToAdhocConference()
      }, 500)
    }

    // Tự động kích hoạt ghi âm máy chủ nếu bật cấu hình autoRecordCalls
    if (localStorage.getItem('smartcall_auto_record_calls') === 'true') {
      const recordingCallId = callState.activeCall?.callId
      setTimeout(async () => {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (
          acceptedEpoch !== callService.callGeneration ||
          !isSessionContextCurrent(acceptedContext) ||
          callState.activeCall?.callId !== recordingCallId
        )
          return
        if (callState.activeCall && !callService.recordingService.isRecording()) {
          try {
            const started = await callService.recordingService.startRecording(null, {
              name: callState.activeCall.name,
              number: callState.activeCall.number,
              extension: callState.activeCall.number,
              dept: callState.activeCall.dept,
              direction: callState.activeCall.direction,
            })
            // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi
            // khác để đổi state.
            if (started && callState.activeCall?.callId === recordingCallId)
              callState.activeCall.isRecorded = true
          } catch (err) {
            logger.warn('RECORD', 'Không thể tự động kích hoạt ghi âm máy chủ:', err.message)
          }
        }
      }, 1200)
    }

    // Gắn luồng âm thanh đàm thoại WebRTC
    try {
      const immediateStream = callService.sdk.Phone.getRemoteStream(callSession)
      if (immediateStream) {
        callService.phoneAdapter.playCallAudio(immediateStream)
      }
    } catch (err) {}

    setTimeout(() => {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (
        acceptedEpoch !== callService.callGeneration ||
        !isSessionContextCurrent(acceptedContext) ||
        !callState.activeCall
      )
        return
      try {
        const sdkAudios = [...document.querySelectorAll('audio')].filter(
          (a) => a.id !== 'wazo-remote-audio' && a.srcObject && !a.paused,
        )
        if (sdkAudios.length > 0) {
          logger.info('AUDIO', 'Luồng âm thanh WebRTC đã được phát tự động bởi Wazo SDK.')
          return
        }
        const stream = callService.sdk.Phone.getRemoteStream(callSession)
        if (stream) {
          callService.phoneAdapter.playCallAudio(stream)
          logger.info('AUDIO', 'Đã kích hoạt luồng âm thanh đàm thoại 2 chiều dự phòng.')
        }
      } catch (err) {
        logger.warn('AUDIO', 'Cảnh báo đồng bộ luồng âm thanh:', err)
      }
    }, 600)

    window.dispatchEvent(new CustomEvent('wazo-accepted', { detail: callSession }))
  }
}

/** Chuyển sự kiện kết thúc về lifecycle dùng chung. */
function createCallEndedHandler(callService) {
  return (callSession) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('ended', callSession)) return
    logger.info('CALL', '⏹️ Sự kiện Wazo: Cuộc gọi đã kết thúc (ON_CALL_ENDED)')
    callService.finalizeCallTermination('ended', callSession)
  }
}

/** Kết thúc nhánh hoặc cuộc gọi khi SDK báo thất bại. */
function createCallFailedHandler(callService) {
  return (callSession) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('failed', callSession)) return
    logger.error(
      'CALL',
      '❌ Sự kiện Wazo: Cuộc gọi thất bại (ON_CALL_FAILED - Máy bận, offline hoặc từ chối)',
    )
    callService.finalizeCallTermination('failed', callSession)
    window.dispatchEvent(new CustomEvent('wazo-failed', { detail: callSession }))
  }
}

/** Xử lý từ chối qua cùng đường cleanup. */
function createCallRejectedHandler(callService) {
  return (callSession) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('rejected', callSession)) return
    logger.warn('CALL', '🚫 Sự kiện Wazo: Cuộc gọi bị từ chối (ON_CALL_REJECTED)')
    callService.finalizeCallTermination('rejected', callSession)
  }
}

/** Phân biệt hủy thông thường và đã trả lời ở thiết bị khác. */
function createCallCanceledHandler(callService) {
  return (callSession, elsewhere) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('canceled', callSession)) return
    logger.warn('CALL', '⚠️ Sự kiện Wazo: Cuộc gọi bị hủy (ON_CALL_CANCELED)', { elsewhere })
    // Nếu thiết bị đã nhấc máy và có cờ elsewhere (cause=26 completed elsewhere do chuyển kênh /
    // ConfBridge)
    // -> Bỏ qua không ngắt cuộc gọi (Đối chiếu WazoSipCallManager.py line 1168)
    if (elsewhere && callState.activeCall && callState.activeCall.status === 'connected') {
      logger.info(
        'CALL',
        'Bỏ qua ON_CALL_CANCELED vì cuộc gọi đã được kết nối (completed elsewhere / bridged).',
      )
      return
    }
    callService.finalizeCallTermination('canceled', callSession)
  }
}
