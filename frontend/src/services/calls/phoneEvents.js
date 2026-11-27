import { callState } from '../../state/callState.js'
import { userSessionState } from '../../state/sessionState.js'
import { captureSessionContext, isSessionContextCurrent } from '../auth/sessionScope.js'
import { logger } from '../common/loggerService.js'

/** Bỏ qua lỗi khi xin đồng bộ snapshot nhóm ở bước phụ trợ, không chặn luồng nhận cuộc gọi. */
function ignoreGroupStateSyncError() {
  /* Yêu cầu đồng bộ nhóm qua presence có thể thất bại tạm thời mà không làm hỏng cuộc gọi đến. */
}

/** Kiểm tra phần tử audio của SDK đã có srcObject và đang tự phát để tránh mở thêm loa dự phòng. */
function isActiveSdkAudioElement(audioElement) {
  return (
    audioElement.id !== 'wazo-remote-audio' &&
    Boolean(audioElement.srcObject) &&
    !audioElement.paused
  )
}

/** Từ chối nhánh gọi đến bị trùng khi máy hiện tại đang bận đàm thoại và ghi nhận cuộc gọi nhỡ. */
function rejectBusyIncomingCall(callService, callSession, extension) {
  logger.warn('CALL', `Đang bận đàm thoại. Tự động từ chối cuộc gọi đến từ máy lẻ ${extension}`)
  try {
    if (callSession && typeof callSession.reject === 'function') {
      callSession.reject()
    } else {
      callService.rejectSdkCall(callSession)
    }
  } catch (error) {
    logger.warn('CALL', 'Không thể từ chối nhanh cuộc gọi đến khi đang bận:', error)
  }

  const contact = callService.contactService.findContactByExtension(extension)
  const name = contact?.name || (extension ? `Máy lẻ ${extension}` : 'Đồng nghiệp')
  const dept = contact?.dept || 'Nội bộ công ty'
  callService.historyService.addRecord({
    name,
    extension,
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
}

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

  /** Bọc handler SDK để callback xếp hàng của phiên/thế hệ cũ không sửa state của phiên mới. */
  function wrapHandlerWithSessionGuard(handler) {
    /** Chỉ chuyển tiếp sự kiện khi listener vẫn đúng thế hệ đăng ký và phiên xác thực. */
    function invokeScopedHandler(...args) {
      // Kể cả khi SDK đã đưa callback vào hàng đợi, phiên cũ không được sửa state của phiên mới.
      if (generation === callService.listenerGeneration && isSessionContextCurrent(context))
        return handler(...args)
    }
    return invokeScopedHandler
  }

  const scopedHandlers = {}
  for (const [name, handler] of Object.entries(handlers)) {
    scopedHandlers[name] = wrapHandlerWithSessionGuard(handler)
  }
  return scopedHandlers
}

/** Tạo handler đánh dấu SIP đã đăng ký và cập nhật hồ sơ người dùng hiện tại. */
function createRegisteredHandler(callService) {
  /** Cập nhật SIP registered và hồ sơ đang dùng sau khi SDK xác nhận đăng ký thành công. */
  function onPhoneRegistered() {
    callService.cancelPhoneReconnect()
    callState.isRegistered = true
    userSessionState.extension = callService.authService.getCurrentExtension()
    userSessionState.userUuid = callService.authService.getCurrentUserUuid()
    userSessionState.displayName = callService.authService.getCurrentDisplayName()
    logger.success('SIP', '🟢 Wazo WebRTC SIP Phone: Registered thành công!')
  }

  return onPhoneRegistered
}

/** Tạo handler đánh dấu mất đăng ký SIP và lên lịch kết nối lại có kiểm chứng phiên. */
function createUnregisteredHandler(callService) {
  /** Đánh dấu mất đăng ký và kiểm chứng phiên trước khi kết nối lại WebRTC Phone. */
  function onPhoneUnregistered() {
    callState.isRegistered = false
    logger.warn('SIP', '🔴 Wazo WebRTC SIP Phone: Unregistered!')
    callService.schedulePhoneReconnect()
  }

  return onPhoneUnregistered
}

/** Tạo handler xử lý sự kiện đổ chuông (180 Ringing / ON_PROGRESS) cho nhánh đang quản lý. */
function createProgressHandler(callService) {
  /** Cập nhật đổ chuông và phát ringback, nhưng không hạ cuộc gọi đã kết nối trước đó. */
  function onCallProgress(callSession) {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('progress', callSession)) return
    logger.info('CALL', '🔔 Sự kiện Wazo: Đường dây đang đổ chuông (ON_PROGRESS / 180 Ringing)')
    if (callState.activeCall && callState.activeCall.status !== 'connected') {
      callState.activeCall.status = 'ringing'
      callService.callToneService.startRingbackTone()
    }
  }

  return onCallProgress
}

/** Tạo handler chuẩn hóa cuộc gọi đến, chống đụng cuộc gọi đang hoạt động và tra tên người gọi. */
function createCallIncomingHandler(callService) {
  /** Chuẩn hóa cuộc gọi đến vào incomingCall hoặc từ chối ngay nếu thiết bị đang bận. */
  function onCallIncoming(callSession) {
    const ext = callSession?.number || callSession?.callerNumber || callSession?.extension || ''
    logger.info('CALL', `🔔 Cuộc gọi đến từ máy lẻ: ${ext || 'N/A'}`, callSession)

    // Chặn cuộc gọi đến thứ hai khi đang có activeCall hoặc incomingCall khác để tránh ghi đè nhánh hiện tại.
    if (
      callState.activeCall ||
      (callState.incomingCall && callState.incomingCall.rawSession !== callSession)
    ) {
      rejectBusyIncomingCall(callService, callSession, ext)
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
      peerUuid: contact?.uuid || '',
      peerEmail: contact?.email || '',
      name,
      dept,
      sipUri,
    }

    callService.groupCallService._requestGroupStateSync('incoming').catch(ignoreGroupStateSyncError)
    if (!contact && ext) {
      const context = captureSessionContext()
      const generation = callService.callGeneration
      const sipId = callService.getSipSessionId(callSession)

      /** Bổ sung tên và UUID người gọi từ Dird nếu vẫn đúng nhánh đang đổ chuông hoặc đã nhận. */
      async function resolveCallerName() {
        try {
          const found = await callService.contactService.getOrLookupContact(ext)
          const current = callState.incomingCall || callState.activeCall
          // Đối chiếu phiên, thế hệ gọi và SIP ID để response Dird đến muộn không đè lên cuộc gọi khác.
          if (
            !found ||
            !current ||
            !sipId ||
            !isSessionContextCurrent(context) ||
            generation !== callService.callGeneration ||
            sipId !== callService.getSipSessionId(current.session || current.rawSession)
          )
            return
          current.name = found.name
          current.dept = found.dept || current.dept
          current.peerUuid = found.uuid || ''
          current.peerEmail = found.email || ''
        } catch {
          // Caller ID SIP vẫn cho phép nghe hoặc từ chối khi Dird không phản hồi.
        }
      }

      void resolveCallerName()
    }
  }

  return onCallIncoming
}

/** Tạo handler xử lý ACK SIP khi đầu dây nhận máy, bắt đầu đồng hồ và gắn audio an toàn. */
function createCallAcceptedHandler(callService) {
  /** Nhận ACK SDK, bắt đầu đồng hồ đàm thoại và gắn luồng âm thanh đúng thế hệ cuộc gọi. */
  function onCallAccepted(callSession) {
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
        peerUuid: contact?.uuid || '',
        peerEmail: contact?.email || '',
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
      callService.groupCallService
        ._requestGroupStateSync('accepted')
        .catch(ignoreGroupStateSyncError)
    } else {
      void callService.confirmDirectCallPeer()
    }

    callService.scheduleAutomaticRecording()

    // Gắn luồng âm thanh đàm thoại WebRTC ngay khi nhận ACK nếu SDK đã có sẵn stream.
    try {
      const immediateStream = callService.sdk.Phone.getRemoteStream(callSession)
      if (immediateStream) {
        callService.phoneAdapter.playCallAudio(immediateStream)
      }
    } catch {
      /* Luồng audio có thể chưa gắn kịp lúc ACK; kiểm tra dự phòng sau 600ms sẽ đồng bộ lại. */
    }

    /** Kiểm tra sau 600ms xem SDK đã tự phát audio chưa; nếu chưa thì kích hoạt thẻ loa dự phòng. */
    function syncFallbackRemoteAudio() {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (
        acceptedEpoch !== callService.callGeneration ||
        !isSessionContextCurrent(acceptedContext) ||
        !callState.activeCall
      )
        return
      try {
        const sdkAudios = [...document.querySelectorAll('audio')].filter(isActiveSdkAudioElement)
        if (sdkAudios.length > 0) {
          logger.info('AUDIO', 'Luồng âm thanh WebRTC đã được phát tự động bởi Wazo SDK.')
          return
        }
        const stream = callService.sdk.Phone.getRemoteStream(callSession)
        if (stream) {
          callService.phoneAdapter.playCallAudio(stream)
          logger.info('AUDIO', 'Đã kích hoạt luồng âm thanh đàm thoại 2 chiều dự phòng.')
        }
      } catch (error) {
        logger.warn('AUDIO', 'Cảnh báo đồng bộ luồng âm thanh:', error)
      }
    }

    setTimeout(syncFallbackRemoteAudio, 600)
  }

  return onCallAccepted
}

/** Tạo handler chuyển sự kiện kết thúc cuộc gọi về vòng đời cleanup chung của CallService. */
function createCallEndedHandler(callService) {
  /** Chuyển sự kiện kết thúc từ SDK về lifecycle cleanup dùng chung. */
  function onCallEnded(callSession) {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('ended', callSession)) return
    logger.info('CALL', '⏹️ Sự kiện Wazo: Cuộc gọi đã kết thúc (ON_CALL_ENDED)')
    callService.finalizeCallTermination('ended', callSession)
  }

  return onCallEnded
}

/** Tạo handler xử lý sự kiện thất bại (máy bận, offline, từ chối) cho nhánh đang quản lý. */
function createCallFailedHandler(callService) {
  /** Kết thúc nhánh hoặc toàn cuộc gọi khi SDK báo cuộc gọi thất bại. */
  function onCallFailed(callSession) {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('failed', callSession)) return
    logger.error(
      'CALL',
      '❌ Sự kiện Wazo: Cuộc gọi thất bại (ON_CALL_FAILED - Máy bận, offline hoặc từ chối)',
    )
    callService.finalizeCallTermination('failed', callSession)
  }

  return onCallFailed
}

/** Tạo handler xử lý sự kiện từ chối cuộc gọi qua cùng đường cleanup. */
function createCallRejectedHandler(callService) {
  /** Dọn nhánh hoặc cuộc gọi khi tổng đài hoặc đầu dây từ chối lời mời. */
  function onCallRejected(callSession) {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('rejected', callSession)) return
    logger.warn('CALL', '🚫 Sự kiện Wazo: Cuộc gọi bị từ chối (ON_CALL_REJECTED)')
    callService.finalizeCallTermination('rejected', callSession)
  }

  return onCallRejected
}

/** Tạo handler phân biệt hủy cuộc gọi thông thường với chuyển kênh ConfBridge / thiết bị khác. */
function createCallCanceledHandler(callService) {
  /** Phân biệt hủy thông thường và tín hiệu completed elsewhere để không ngắt nhầm cuộc đã nối. */
  function onCallCanceled(callSession, elsewhere) {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (!callService.acceptManagedCallEvent('canceled', callSession)) return
    logger.warn('CALL', '⚠️ Sự kiện Wazo: Cuộc gọi bị hủy (ON_CALL_CANCELED)', { elsewhere })
    // Nếu thiết bị đã nhấc máy và có cờ elsewhere (cause=26 completed elsewhere do chuyển kênh
    // sang ConfBridge hoặc thiết bị khác đã nhận cuộc), bỏ qua để không ngắt nhầm cuộc gọi.
    if (elsewhere && callState.activeCall && callState.activeCall.status === 'connected') {
      logger.info(
        'CALL',
        'Bỏ qua ON_CALL_CANCELED vì cuộc gọi đã được kết nối (completed elsewhere / bridged).',
      )
      return
    }
    callService.finalizeCallTermination('canceled', callSession)
  }

  return onCallCanceled
}
