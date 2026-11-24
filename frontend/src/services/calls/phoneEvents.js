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
    callService.cancelPhoneReconnect()
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

    callService.schedulePhoneReconnect()
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
    callService.groupCallService._requestGroupStateSync('incoming').catch(() => {})
  }
}

/** Nhận ACK SDK, bắt đầu đồng hồ và gắn media đúng thế hệ. */
function createCallAcceptedHandler(callService) {
  return (callSession) => {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('accepted', callSession)) return
    // Không dựng lại cuộc gọi từ event đến muộn khi cả nhánh active và incoming đã được dọn.
    if (!callState.activeCall && !callState.incomingCall) return
    const acceptedEpoch = callService.callGeneration
    const acceptedContext = captureSessionContext()
    // SIP accepted có thể là Playback/voicemail. Với host gọi nhóm, chỉ Calld được xác nhận
    // người nghe và mở audio. Giữ timer mời để nhánh chỉ có thông báo vẫn được dọn.
    if (
      callService.groupCallService.state.isGroupCall &&
      callService.groupCallService.state.isGroupHost
    ) {
      callService.groupCallService.syncActiveCallsToAdhocConference()
      callService.groupCallService.scheduleConferenceRetry(acceptedEpoch)
      return
    }

    callService.answeredSipIds.add(callService.getSipSessionId(callSession))
    callService.currentCallSession = callSession
    logger.success('CALL', '🟢 Sự kiện Wazo: Phiên SIP đã trả lời, có thể phát âm thanh.')
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
    // Người nhận đã bấm nghe trên Web; phía gọi đi phải đợi đúng người đối thoại từ Calld.
    if (callState.activeCall.direction === 'inbound') {
      callState.activeCall.peerConfirmed = true
      callService.groupCallService._requestGroupStateSync('accepted').catch(() => {})
    } else {
      void callService.confirmDirectCallPeer()
    }

    callService.scheduleAutomaticRecording()

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
