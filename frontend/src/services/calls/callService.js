import { normalizeExtension, getContactCallRestriction } from '../../utils/callPolicy.js'
import { createPhoneEventHandlers } from './phoneEvents.js'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
} from '../auth/sessionScope.js'
import { callState } from '../../state/callState.js'
import { logger } from '../common/loggerService.js'

/** Bỏ qua lỗi promise khi dọn nhánh hoặc hội nghị nền để không làm kẹt vòng đời kết thúc cuộc gọi. */
function ignoreCallCleanupRejection() {
  /* Tài nguyên trên tổng đài có thể đã tự kết thúc trước khi nhận lệnh cleanup nền. */
}

/** Kiểm tra thiết bị MediaDeviceInfo hiện tại có phải đầu vào microphone hay không. */
function isAudioInputDevice(device) {
  return device.kind === 'audioinput'
}

/** Ghi cảnh báo khi tổng đài chưa xác nhận dừng ghi âm tự động lúc cuộc gọi vừa kết thúc. */
function logStopRecordingWarning(error) {
  logger.warn('RECORD', 'Chưa xác nhận dừng ghi âm:', error.message)
}

/** Điều phối cuộc gọi Web và sự kiện SDK; giao việc quản lý hội nghị cho GroupCallService. */
export class CallService {
  /**
   * Nhận các service cần cho thoại và chuẩn bị trạng thái kết nối, listener, timer cùng định danh
   * thế hệ cuộc gọi.
   */
  constructor({
    sdk,
    authService,
    phoneAdapter,
    contactService,
    historyService,
    recordingService,
    callToneService,
    callControlApi,
  }) {
    Object.assign(this, {
      sdk,
      authService,
      phoneAdapter,
      contactService,
      historyService,
      recordingService,
      callToneService,
      callControlApi,
    })
    this.connectionGeneration = 0
    this.connectPromise = null
    this.phoneReconnectTask = null
    this.disconnectionPromise = null
    this.listenerGeneration = 0
    this.dialingAttempt = 0
    this.dialingReleaseTimer = null
    this.currentCallSession = null
    this.listenersAttached = false
    this._durationInterval = null
    this.pendingSdkCalls = 0
    this.pendingCallEvents = new Map()
    this.answeredSipIds = new Set()
    this.callGeneration = 0
    this._onRegisteredHandler = null
    this._onUnregisteredHandler = null
    this._onProgressHandler = null
    this._onCallIncomingHandler = null
    this._onCallAcceptedHandler = null
    this._onCallEndedHandler = null
    this._onCallFailedHandler = null
    this._onCallRejectedHandler = null
    this._onCallCanceledHandler = null
  }

  /** Gắn bộ điều phối hội nghị sau khi tạo instance để không tạo import ngược. */
  attachGroupCoordinator(groupCallService) {
    this.groupCallService = groupCallService
  }

  /** SIP chỉ sẵn sàng khi SDK đã phát ON_REGISTERED. */
  isRegistered() {
    return callState.isRegistered
  }

  /** Đọc khóa chống quay số trùng trong state cuộc gọi. */
  get isDialing() {
    return callState.dialing
  }

  /** Cập nhật khóa chống quay số trùng trong state cuộc gọi. */
  set isDialing(value) {
    callState.dialing = value
  }

  /** Gộp các yêu cầu kết nối thoại đồng thời và đợi lệnh SDK hoàn tất. */
  connect() {
    // Chặn mở WebRTC Phone khi phiên xác thực chưa sẵn sàng để tránh gửi đăng ký SIP vô hiệu.
    if (!this.authService.isAuthenticated())
      return Promise.reject(new Error('Cần đăng nhập trước khi kết nối thoại.'))
    if (callState.isRegistered) return Promise.resolve(true)
    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this.connectPromise) return this.connectPromise
    const callService = this
    const context = captureSessionContext()
    const generation = ++this.connectionGeneration

    /** Xóa promise kết nối đang chờ nếu thao tác vẫn thuộc thế hệ kết nối hiện tại. */
    function clearPendingConnectPromise() {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (generation === callService.connectionGeneration) callService.connectPromise = null
    }

    this.connectPromise = this._executePhoneConnect(context, generation).finally(
      clearPendingConnectPromise,
    )
    return this.connectPromise
  }

  /** Thực thi quy trình kết nối WebRTC Phone với cấu hình thiết bị cục bộ và gắn listener đúng thế hệ. */
  async _executePhoneConnect(context, generation) {
    const callService = this
    try {
      // SDK disconnect đóng phone sau await; không kết nối mới khi cleanup cũ còn chạy.
      if (this.disconnectionPromise) await this.disconnectionPromise
      assertSessionContext(context)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
      // đến muộn sau hủy/đổi phiên.
      if (generation !== this.connectionGeneration) throw new Error('Kết nối thoại đã bị hủy.')
      // SDK xóa listener trong connect(); gỡ thế hệ cũ rồi gắn sau khi SDK hoàn tất.
      this.detachPhoneListeners()
      const microphoneId = localStorage.getItem('smartcall_selected_mic')
      await this.sdk.Phone.connect({
        media: {
          audio:
            microphoneId && microphoneId !== 'default'
              ? { deviceId: { exact: microphoneId } }
              : true,
          video: false,
        },
        audioDeviceOutput: localStorage.getItem('smartcall_selected_speaker') || 'default',
      })
      assertSessionContext(context)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
      // đến muộn sau hủy/đổi phiên.
      if (generation !== this.connectionGeneration) throw new Error('Kết nối thoại đã bị hủy.')
      this.attachPhoneListeners()
      // REGISTERED có thể phát sớm; đọc trạng thái thật thay vì suy từ token.
      if (this.sdk.Phone.phone?.isRegistered?.()) this._onRegisteredHandler()
      await this.phoneAdapter.applyAudioDevices()
      assertSessionContext(context)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
      // đến muộn sau hủy/đổi phiên.
      if (generation !== this.connectionGeneration) throw new Error('Kết nối thoại đã bị hủy.')
      this.phoneAdapter.disableSdkAutomaticHold()

      /** Đọc chính sách phát âm thanh hiện tại mỗi khi SDK chuẩn bị gắn media của một nhánh SIP. */
      function shouldMuteInviteAudio(sipId, startedMuted) {
        return callService.groupCallService.shouldMuteSipAudio(sipId, startedMuted)
      }

      this.phoneAdapter.guardGroupInviteAudio(shouldMuteInviteAudio)
      logger.info(
        'SIP',
        'Đã gửi lệnh kết nối thoại; trạng thái sẵn sàng do ON_REGISTERED quyết định.',
      )
      return true
    } catch (error) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
      // đến muộn sau hủy/đổi phiên.
      if (generation === this.connectionGeneration) {
        callState.isRegistered = false
        this.detachPhoneListeners()
      }
      logger.warn('SIP', 'Không thể hoàn tất kết nối thoại:', error.message)
      throw error
    }
  }

  /** Hủy cả timer và quyền chạy tiếp của reconnect đang chờ kiểm tra phiên. */
  cancelPhoneReconnect() {
    if (this.phoneReconnectTask) clearTimeout(this.phoneReconnectTask.timer)
    this.phoneReconnectTask = null
  }

  /** Gộp các UNREGISTERED liên tiếp thành một lần thử lại, không nhân timer với retry SDK. */
  schedulePhoneReconnect() {
    // Chỉ lên lịch một reconnect duy nhất khi phiên còn hiệu lực và chưa bị thu hồi.
    if (
      this.phoneReconnectTask ||
      !this.authService.isAuthenticated() ||
      this.authService.isSessionRevoked
    )
      return
    const callService = this
    const context = captureSessionContext()
    const task = { timer: null }
    this.phoneReconnectTask = task

    /** Kiểm tra lại sức khỏe token trước khi kết nối lại SIP Phone sau mất đăng ký. */
    async function runScheduledReconnect() {
      try {
        const isValid = await callService.authService.verifySessionHealth()
        // Timer/HTTP cũ không được kết nối lại sau logout, REGISTERED hoặc thay phiên.
        if (callService.phoneReconnectTask !== task || !isSessionContextCurrent(context)) return
        if (!isValid && callService.authService.refreshTokenRevoked) {
          callService.authService.handleSessionRevocation()
          return
        }
        if (
          !callService.authService.isAuthenticated() ||
          callService.authService.isSessionRevoked ||
          callState.isRegistered
        )
          return
        logger.info('SIP', 'Đang thử kết nối lại WebRTC Phone sau khi mất đăng ký...')
        await callService.connect()
      } catch (error) {
        if (callService.phoneReconnectTask === task && isSessionContextCurrent(context))
          logger.warn('SIP', 'Không thể kết nối lại WebRTC Phone:', error.message)
      } finally {
        if (callService.phoneReconnectTask === task) callService.phoneReconnectTask = null
      }
    }

    task.timer = setTimeout(runScheduledReconnect, 5000)
  }

  /** Hủy kết nối đang chờ, gỡ listener và dừng tài nguyên âm thanh. */
  disconnect() {
    this.cancelPhoneReconnect()
    this.connectionGeneration += 1
    this.connectPromise = null
    this.cancelPendingDial()

    /** Ghi log cảnh báo nếu Promise ngắt kết nối của SDK trả về lỗi. */
    function logSdkDisconnectError(error) {
      logger.warn('SIP', 'Không hoàn tất ngắt kết nối SDK:', error.message)
    }

    try {
      callState.isRegistered = false
      this.phoneAdapter.stopCallAudio()
      this.callToneService.stopAllTones()

      // BUG-06: Gỡ bỏ phòng vệ toàn bộ listener của Wazo.Phone trước khi disconnect
      this.detachPhoneListeners()

      if (this.sdk && this.sdk.Phone && typeof this.sdk.Phone.disconnect === 'function') {
        const cleanup = this.sdk.Phone.disconnect()
        this.disconnectionPromise = Promise.resolve(cleanup).catch(logSdkDisconnectError)
      }
      logger.info('SIP', 'Đã ngắt kết nối Wazo WebRTC Phone')
    } catch (error) {
      logger.warn('SIP', 'Lỗi khi ngắt kết nối Wazo WebRTC Phone:', error)
    } finally {
      this.listenersAttached = false
    }
    return this.disconnectionPromise
  }

  /** Đếm thời lượng từ thời điểm cuộc gọi thực sự được kết nối. */
  startCallDurationTimer() {
    this.stopCallDurationTimer()

    /** Cập nhật số giây đàm thoại đang hiển thị dựa trên mốc startTime khi đã connected. */
    function updateActiveCallDuration() {
      if (callState.activeCall && callState.activeCall.status === 'connected') {
        if (callState.activeCall.startTime) {
          callState.activeCall.duration = Math.max(
            0,
            Math.floor((Date.now() - callState.activeCall.startTime) / 1000),
          )
        } else {
          callState.activeCall.duration = (callState.activeCall.duration || 0) + 1
        }
      }
    }

    this._durationInterval = setInterval(updateActiveCallDuration, 1000)
  }

  /** Dừng đồng hồ đàm thoại khi nhánh gọi hoặc cuộc gọi kết thúc. */
  stopCallDurationTimer() {
    if (this._durationInterval) {
      clearInterval(this._durationInterval)
      this._durationInterval = null
    }
  }

  /** Đối chiếu hai phiên SIP theo tham chiếu object hoặc SIP ID hợp lệ để tránh nhầm nhánh khác. */
  _matchesManagedSession(firstSession, secondSession) {
    if (!firstSession || !secondSession) return false
    if (firstSession === secondSession) return true
    const firstSipId = this.getSipSessionId(firstSession)
    const secondSipId = this.getSipSessionId(secondSession)
    return Boolean(firstSipId && secondSipId && firstSipId === secondSipId)
  }

  /** Xóa bỏ nhánh phụ mất kết nối khỏi danh sách nhóm, giải phóng audio và thông báo cho các máy. */
  _removeDisconnectedSecondaryParticipant(endedSecExt, session, reason) {
    logger.warn(
      'CALL',
      `Nhánh phụ [${endedSecExt}] kết thúc (${reason}). Gỡ khỏi nhóm và duy trì các nhánh còn lại.`,
    )
    const childCallId = this.groupCallService.state.extensionToWazoCallIdMap.get(endedSecExt)
    this.groupCallService.releaseGroupAudio(session)
    if (childCallId) {
      this.callControlApi.hangupServerCall(childCallId).catch(ignoreCallCleanupRejection)
      this.groupCallService.state.extensionToWazoCallIdMap.delete(endedSecExt)
      this.groupCallService.state.mergedCallIds.delete(childCallId)
    }

    /** Giữ lại các máy lẻ thành viên khác với nhánh phụ vừa ngắt kết nối. */
    function isRemainingParticipant(extension) {
      return extension !== endedSecExt
    }

    this.groupCallService.state.groupParticipantExtensions =
      this.groupCallService.state.groupParticipantExtensions.filter(isRemainingParticipant)
    this.groupCallService._syncGroupDisplayState()

    if (callState.activeCall) {
      callState.activeCall.groupParticipantExtensions = [
        ...this.groupCallService.state.groupParticipantExtensions,
      ]
      callState.activeCall.groupTitle =
        callState.activeCall.savedGroupName ||
        `Cuộc gọi nhóm (${this.groupCallService.state.groupParticipantExtensions.length} người)`
      if (callState.activeCall.number === endedSecExt) {
        const myExt = this.authService.getCurrentExtension()

        /** Lọc ra thành viên khác ngoài host hiện tại để cập nhật số đại diện hiển thị. */
        function isOtherGroupMember(extension) {
          return extension !== myExt
        }

        const remainingOthers =
          this.groupCallService.state.groupParticipantExtensions.filter(isOtherGroupMember)
        if (remainingOthers.length > 0) {
          callState.activeCall.number = remainingOthers[0]
          const contact = this.contactService.findContactByExtension(remainingOthers[0])
          if (contact?.name) {
            callState.activeCall.name = contact.name
          }
        }
      }
    }

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Nhánh máy lẻ ${endedSecExt} không thể kết nối hoặc đã rời nhóm`,
          type: 'warning',
        },
      }),
    )
    this.groupCallService.broadcastGroupStateViaPresence()
    this.groupCallService.broadcastNoticeToGroup(
      `Nhánh máy lẻ ${endedSecExt} không thể kết nối hoặc đã rời nhóm`,
    )
  }

  /** Kiểm tra sau khi gỡ nhánh phụ xem cuộc gọi nhóm vẫn còn người nối hoặc đang đổ chuông hay không. */
  _shouldKeepGroupAliveAfterSecondaryEnd() {
    const myExt = this.authService.getCurrentExtension()

    /** Xác định thành viên còn lại khác với host để tránh giữ nhóm khi chỉ còn một mình host. */
    function isOtherGroupMember(extension) {
      return extension !== myExt
    }

    const remainingOthers =
      this.groupCallService.state.groupParticipantExtensions.filter(isOtherGroupMember)
    return Boolean(
      this.groupCallService.isAnyParticipantConnected() ||
      this.groupCallService.state.secondaryCallSessions.size > 0 ||
      (this.currentCallSession &&
        remainingOthers.length > 0 &&
        callState.activeCall?.status === 'ringing'),
    )
  }

  /**
   * Xử lý sự kiện kết thúc của một nhánh phụ trong cuộc gọi nhóm của host.
   * Trả true nếu cuộc gọi nhóm vẫn phải tiếp tục duy trì (hoặc hoãn do chuyển vào ConfBridge).
   */
  _handleSecondaryGroupLegTermination(reason, session, endedSipId) {
    let endedSecExt = null
    for (const [ext, secSession] of this.groupCallService.state.secondaryCallSessions.entries()) {
      // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác
      // để đổi state.
      if (this._matchesManagedSession(secSession, session)) {
        endedSecExt = ext
        break
      }
    }

    // Nhận diện thêm nếu SIP ID nằm trong danh sách đang hủy do timeout
    const isMarkedTerminating = Boolean(
      endedSipId && this.groupCallService._terminatingSecondarySipIds.has(endedSipId),
    )
    if (isMarkedTerminating && endedSipId) {
      this.groupCallService._terminatingSecondarySipIds.delete(endedSipId)
    }

    if (!endedSecExt && !isMarkedTerminating) return false

    if (endedSecExt) {
      // Chờ REST ghép trả kết quả trước khi diễn giải kết thúc nhánh đã nghe máy.
      if (
        this.groupCallService._isSyncingAdhoc &&
        !isMarkedTerminating &&
        (session.answered || this.answeredSipIds.has(endedSipId))
      ) {
        this.groupCallService._pendingConferenceTerminations.set(endedSipId, {
          reason,
          session,
        })
        return true
      }

      this.groupCallService.clearParticipantInviteTimeout(endedSecExt)
      this.groupCallService.state.secondaryCallSessions.delete(endedSecExt)

      // Nếu đã có Ad-hoc Conference hoạt động và không phải nhánh timeout, nhánh SIP phụ
      // WebRTC kết thúc chỉ do Asterisk chuyển kênh thoại sang ConfBridge, nên Web vẫn giữ
      // thành viên này trong nhóm.
      const participantCallId =
        this.groupCallService.state.extensionToWazoCallIdMap.get(endedSecExt)
      if (
        this.groupCallService.state.activeAdhocConferenceId &&
        this.groupCallService.state.mergedCallIds.has(participantCallId) &&
        !isMarkedTerminating
      ) {
        logger.info(
          'CALL',
          `Nhánh WebRTC phụ [${endedSecExt}] đã chuyển giao sang Ad-hoc Conference [${this.groupCallService.state.activeAdhocConferenceId}]. Tiếp tục duy trì thành viên trong nhóm.`,
        )
        return true
      }

      this._removeDisconnectedSecondaryParticipant(endedSecExt, session, reason)
    }

    // Chỉ kết thúc toàn nhóm khi không còn thành viên nào nối thoại và không còn nhánh đang đổ chuông.
    if (this._shouldKeepGroupAliveAfterSecondaryEnd()) {
      logger.info(
        'CALL',
        'Vẫn còn thành viên đang hoạt động hoặc đang đổ chuông trong nhóm. Duy trì cuộc gọi!',
      )
      return true
    }

    logger.warn(
      'CALL',
      'Tất cả thành viên trong nhóm đều đã ngắt kết nối hoặc không nghe máy. Kết thúc cuộc gọi.',
    )
    return false
  }

  /** Đưa nhánh phụ đầu tiên lên thay nhánh chính vừa ngắt để giữ nguyên vai trò host của người gọi. */
  _promoteSecondaryLegToPrimary() {
    const [nextExt, nextSession] = this.groupCallService.state.secondaryCallSessions
      .entries()
      .next().value
    logger.info(
      'CALL',
      `Nhánh chính kết thúc. Tự động chuyển nhánh [${nextExt}] lên làm nhánh chính tiếp tục cuộc gọi nhóm.`,
    )
    const oldPrimaryExt = callState.activeCall?.number
    this.groupCallService.state.secondaryCallSessions.delete(nextExt)
    this.currentCallSession = nextSession
    if (callState.activeCall) {
      callState.activeCall.number = nextExt
      callState.activeCall.session = nextSession
    }

    // Gỡ số máy nhánh chính cũ khỏi groupParticipantExtensions và thu hồi call ID nếu có
    if (oldPrimaryExt) {
      /** Lọc bỏ máy lẻ nhánh chính cũ vừa mất kết nối khỏi danh sách tham gia. */
      function isNotOldPrimaryExtension(extension) {
        return extension !== oldPrimaryExt
      }

      this.groupCallService.state.groupParticipantExtensions =
        this.groupCallService.state.groupParticipantExtensions.filter(isNotOldPrimaryExtension)
      const childCallId = this.groupCallService.state.extensionToWazoCallIdMap.get(oldPrimaryExt)
      if (childCallId) {
        this.callControlApi.hangupServerCall(childCallId).catch(ignoreCallCleanupRejection)
        this.groupCallService.state.extensionToWazoCallIdMap.delete(oldPrimaryExt)
        this.groupCallService.state.mergedCallIds.delete(childCallId)
      }
    }

    if (callState.activeCall) {
      callState.activeCall.groupParticipantExtensions = [
        ...this.groupCallService.state.groupParticipantExtensions,
      ]
      callState.activeCall.groupTitle =
        callState.activeCall.savedGroupName ||
        `Cuộc gọi nhóm (${this.groupCallService.state.groupParticipantExtensions.length} người)`
    }

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `⚠️ Nhánh máy lẻ ${oldPrimaryExt || 'chính'} không thể kết nối hoặc đã kết thúc`,
          type: 'warning',
        },
      }),
    )
    this.groupCallService._syncGroupDisplayState()
    this.groupCallService.broadcastGroupStateViaPresence()
    this.groupCallService.broadcastNoticeToGroup(
      `Nhánh máy lẻ ${oldPrimaryExt} không thể kết nối hoặc đã kết thúc`,
    )
  }

  /**
   * Xử lý khi nhánh SIP chính của host kết thúc trong cuộc gọi nhóm (hoãn lúc khởi tạo hoặc
   * chuyển nhánh phụ lên thay, giữ nguyên host).
   */
  _handlePrimaryGroupLegTermination(reason, session) {
    // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
    // đổi state.
    if (!this._matchesManagedSession(session, this.currentCallSession)) return false

    this.groupCallService.clearPrimaryInviteTimeout()
    if (this.groupCallService.deferInitialPrimaryTermination(reason, session)) return true
    if (!this.groupCallService.state.activeAdhocConferenceId)
      this.groupCallService.releaseGroupAudio(session)

    if (this.groupCallService.state.secondaryCallSessions.size > 0) {
      this._promoteSecondaryLegToPrimary()
      return true
    }

    if (
      this.groupCallService.state.activeAdhocConferenceId &&
      this.groupCallService.isAnyParticipantConnected()
    ) {
      logger.info(
        'CALL',
        'Nhánh chính WebRTC chuyển trạng thái nhưng cuộc gọi nhóm vẫn đang kết nối thành viên. Duy trì cuộc gọi.',
      )
      return true
    }

    return false
  }

  /** Điều phối kết thúc từng nhánh SIP trong cuộc gọi nhóm do máy hiện tại làm chủ phòng. */
  _handleGroupLegTermination(reason, session, forceEnd) {
    // Khi bắt buộc kết thúc toàn cuộc gọi (forceEnd) hoặc không phải host gọi nhóm thì bỏ qua nhánh giữ nhóm.
    if (
      forceEnd ||
      !this.groupCallService.state.isGroupCall ||
      !this.groupCallService.state.isGroupHost ||
      !session
    )
      return false

    const endedSipId = this.getSipSessionId(session)
    if (this._handleSecondaryGroupLegTermination(reason, session, endedSipId)) return true
    if (this._handlePrimaryGroupLegTermination(reason, session)) return true
    return false
  }

  /** Dọn incomingCall cũ nếu event kết thúc thuộc về cuộc gọi đến đang chờ thay vì activeCall. */
  _clearStaleIncomingCall(endedSipId) {
    if (!callState.incomingCall) return
    const incSession = callState.incomingCall.session || callState.incomingCall.rawSession
    const incSipId = incSession ? this.getSipSessionId(incSession) : ''
    // Chỉ dọn khi incomingCall không có SIP ID hoặc trùng đúng SIP ID vừa kết thúc.
    if (!incSipId || incSipId === endedSipId) {
      this._recordMissedIncomingHistory(
        callState.incomingCall,
        'Không thể ghi nhận CDR cho cuộc gọi đến bị nhỡ:',
      )
      callState.incomingCall = null
      this.callToneService.stopIncomingRingtone()
    }
  }

  /**
   * Guard chống kết thúc nhầm activeCall khi event đến từ một phiên SIP khác; vẫn dọn
   * incomingCall nếu khớp.
   */
  _shouldIgnoreUnmatchedSessionTermination(session, forceEnd) {
    // BUG-05: Không dùng event của phiên SIP khác để cắt activeCall đang đàm thoại.
    if (forceEnd || !session || !callState.activeCall?.session) return false
    const activeSipId = this.getSipSessionId(callState.activeCall.session)
    const endedSipId = this.getSipSessionId(session)
    if (activeSipId && endedSipId && activeSipId !== endedSipId) {
      logger.warn(
        'CALL',
        `🛡️ Bỏ qua _finalizeCallTermination: Session kết thúc (${endedSipId}) không khớp với activeCall (${activeSipId}).`,
      )
      this._clearStaleIncomingCall(endedSipId)
      return true
    }
    return false
  }

  /** Gửi lệnh dừng ghi âm máy chủ nếu cuộc gọi vừa kết thúc vẫn đang bật ghi âm. */
  _stopActiveRecordingOnTermination() {
    if (!this.recordingService.isRecording()) return
    try {
      this.recordingService.stopRecording().catch(logStopRecordingWarning)
    } catch (recErr) {
      logger.warn('RECORD', 'Lỗi dừng ghi âm máy chủ:', recErr)
    }
  }

  /** Lưu một bản ghi cuộc gọi nhỡ vào lịch sử tạm trong RAM với bảo vệ lỗi không chặn cleanup. */
  _recordMissedIncomingHistory(incoming, warnMessage) {
    try {
      this.historyService.addRecord({
        name:
          incoming.name ||
          (incoming.extension || incoming.number
            ? `Máy lẻ ${incoming.extension || incoming.number}`
            : 'Đồng nghiệp'),
        extension: incoming.extension || incoming.number || '',
        dept: incoming.dept || '',
        duration: 0,
        direction: 'inbound',
        status: 'missed',
        answered: false,
      })
    } catch (cdrErr) {
      logger.warn('CALL', warnMessage, cdrErr)
    }
  }

  /** Ghi nhận lịch sử cuộc gọi (thành công, từ chối hoặc nhỡ) trước khi xóa state hiển thị. */
  _recordTerminatedCallHistory(active, incoming, reason) {
    if (active) {
      const wasConnected = active.status === 'connected'
      let status = 'declined'
      if (wasConnected) {
        status = 'success'
      } else if (reason === 'failed') {
        status = 'declined'
      } else if (active.direction === 'inbound') {
        status = 'missed'
      }

      const finalDuration = wasConnected
        ? active.startTime
          ? Math.max(0, Math.floor((Date.now() - active.startTime) / 1000))
          : active.duration || 0
        : 0

      try {
        this.historyService.addRecord({
          name: active.name || (active.number ? `Máy lẻ ${active.number}` : 'Đồng nghiệp'),
          extension: active.number || '',
          dept: active.dept || '',
          duration: finalDuration,
          direction: active.direction || 'outbound',
          status,
          answered: wasConnected,
        })
      } catch (cdrErr) {
        logger.warn('CALL', 'Không thể ghi nhận CDR cho cuộc gọi hoạt động:', cdrErr)
      }
      return
    }

    if (incoming) {
      this._recordMissedIncomingHistory(incoming, 'Không thể ghi nhận CDR cho cuộc gọi nhỡ:')
    }
  }

  /** Giải tán hội nghị Ad-hoc, ngắt các nhánh máy chủ và cúp mọi nhánh phụ khi host dừng cuộc gọi. */
  _cleanupHostGroupOnHangup(remoteCleanup = true) {
    this.groupCallService.clearAllParticipantInviteTimeouts()
    this.groupCallService.clearPrimaryInviteTimeout()
    if (remoteCleanup && this.groupCallService.state.activeAdhocConferenceId) {
      this.callControlApi
        .deleteConference(this.groupCallService.state.activeAdhocConferenceId)
        .catch(ignoreCallCleanupRejection)
    }
    const childCallIds = remoteCleanup
      ? Array.from(this.groupCallService.state.extensionToWazoCallIdMap.values())
      : []
    for (const cId of childCallIds) {
      if (cId) {
        this.callControlApi.hangupServerCall(cId).catch(ignoreCallCleanupRejection)
      }
    }
    for (const [, secSession] of this.groupCallService.state.secondaryCallSessions.entries()) {
      try {
        this.sdk.Phone.hangup(secSession)
      } catch {
        /* Nhánh phụ có thể đã tự ngắt trước đó; tiếp tục thu hồi các nhánh còn lại. */
      }
    }
    this.groupCallService.state.secondaryCallSessions.clear()
  }

  /** Dừng timer, audio, tài nguyên nhóm và đưa callState cùng presence về trạng thái sẵn sàng. */
  _resetLocalCallResources({ active, incoming, remoteCleanup }) {
    this.stopCallDurationTimer()
    this.currentCallSession = null
    this.phoneAdapter.stopCallAudio()
    this.callToneService.stopAllTones()

    // Dọn dẹp Ad-hoc Group Call và ngắt các nhánh thành viên nếu phiên này là Chủ phòng.
    if (this.groupCallService.state.isGroupCall && this.groupCallService.state.isGroupHost) {
      this._cleanupHostGroupOnHangup(remoteCleanup)
    }
    this.groupCallService.resetGroupState()
    try {
      this.authService.updatePresence('available', this.authService.mySessionId)
    } catch {
      /* Không để lỗi cập nhật presence làm kẹt quá trình giải phóng state cuộc gọi cục bộ. */
    }

    if (active || incoming) {
      this.callToneService.playCallEndedTone()
    }

    callState.activeCall = null
    callState.incomingCall = null
  }

  /** Kết thúc đúng nhánh hoặc toàn cuộc gọi và thu hồi tài nguyên liên quan theo đúng thứ tự. */
  finalizeCallTermination(
    reason = 'ended',
    session = null,
    forceEnd = false,
    remoteCleanup = true,
  ) {
    // 1. Nhánh nhóm đang chạy hoặc chuyển vào ConfBridge có thể giữ nguyên cuộc gọi chính.
    if (this._handleGroupLegTermination(reason, session, forceEnd)) return

    // 2. Bảo vệ activeCall khỏi sự kiện kết thúc đến từ một phiên SIP khác không khớp.
    if (this._shouldIgnoreUnmatchedSessionTermination(session, forceEnd)) return

    this.cancelPendingDial()
    this.recordingService.cancelPendingStart()
    const active = callState.activeCall
    const incoming = callState.incomingCall

    if (active) {
      this._stopActiveRecordingOnTermination()
    }
    this._recordTerminatedCallHistory(active, incoming, reason)
    this._resetLocalCallResources({ active, incoming, remoteCleanup })

    window.dispatchEvent(new CustomEvent('smartcall-call-ended', { detail: { reason, session } }))
  }

  /** Gỡ callback theo đúng tham chiếu đã đăng ký và vô hiệu hóa callback đang xếp hàng. */
  detachPhoneListeners() {
    this.listenerGeneration += 1
    try {
      if (this.sdk && this.sdk.Phone) {
        const events = [
          [this.sdk.Phone.ON_CALL_ENDED, this._onCallEndedHandler],
          [this.sdk.Phone.ON_CALL_FAILED, this._onCallFailedHandler],
          [this.sdk.Phone.ON_CALL_REJECTED, this._onCallRejectedHandler],
          [this.sdk.Phone.ON_CALL_CANCELED, this._onCallCanceledHandler],
          [this.sdk.Phone.ON_CALL_ACCEPTED, this._onCallAcceptedHandler],
          [this.sdk.Phone.ON_PROGRESS, this._onProgressHandler],
          [this.sdk.Phone.ON_CALL_INCOMING, this._onCallIncomingHandler],
          [this.sdk.Phone.ON_REGISTERED, this._onRegisteredHandler],
          [this.sdk.Phone.ON_UNREGISTERED, this._onUnregisteredHandler],
        ]

        for (const [evt, handler] of events) {
          if (!evt) continue
          try {
            if (handler && typeof this.sdk.Phone.off === 'function') {
              this.sdk.Phone.off(evt, handler)
            }
          } catch {
            /* Bỏ qua lỗi gỡ từng handler để vẫn tiếp tục gỡ toàn bộ event khác. */
          }
          try {
            if (
              this.sdk.Phone.eventEmitter &&
              typeof this.sdk.Phone.eventEmitter.removeAllListeners === 'function'
            ) {
              this.sdk.Phone.eventEmitter.removeAllListeners(evt)
            }
          } catch {
            /* eventEmitter của SDK có thể chưa khởi tạo hoặc đã được dọn khi ngắt kết nối. */
          }
        }
      }
    } catch (err) {
      logger.warn('SIP', 'Lỗi khi gỡ bỏ listeners Wazo.Phone:', err)
    } finally {
      this.listenersAttached = false
    }
  }

  /** Đăng ký callback có tên để có thể gỡ đầy đủ khi đổi phiên. */
  attachPhoneListeners() {
    if (this.listenersAttached) return
    this.listenersAttached = true
    Object.assign(this, createPhoneEventHandlers(this))
    this.sdk.Phone.on(this.sdk.Phone.ON_REGISTERED, this._onRegisteredHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_UNREGISTERED, this._onUnregisteredHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_PROGRESS, this._onProgressHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_CALL_INCOMING, this._onCallIncomingHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_CALL_ACCEPTED, this._onCallAcceptedHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_CALL_ENDED, this._onCallEndedHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_CALL_FAILED, this._onCallFailedHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_CALL_REJECTED, this._onCallRejectedHandler)
    this.sdk.Phone.on(this.sdk.Phone.ON_CALL_CANCELED, this._onCallCanceledHandler)
  }

  /** Nhận diện một nhánh bằng SIP ID, không dựa vào số điện thoại hoặc thời điểm nhận event. */
  getSipSessionId(session) {
    try {
      return String(session?.sipCallId || session?.getId?.() || session?.id || '')
    } catch {
      /* Session SDK có thể thiếu getter hợp lệ; trả chuỗi rỗng để không ghép nhầm nhánh. */
      return ''
    }
  }

  /** Đối chiếu nhánh Calld và đối tác đã nối; kênh phát thông báo có thể trả lời SIP nhưng thiếu đối tác. */
  findConnectedPeer(call, session, extension) {
    const sipId = this.getSipSessionId(session)
    const target = normalizeExtension(extension)
    // Chỉ chấp nhận nhánh Calld khớp đúng SIP ID hiện tại và đã có bridge + đối tác nói chuyện.
    if (!sipId || !target || String(call?.sip_call_id || '') !== sipId) return ''
    if (!Array.isArray(call.bridges) || !call.bridges.length || !call.talking_to) return ''

    const active = callState.activeCall
    const expectedUuid =
      normalizeExtension(active?.number) === target && active?.peerUuid
        ? active.peerUuid
        : this.contactService.findContactByExtension(target)?.uuid
    const peers = Object.entries(call.talking_to)
    for (const [peerId, peerUuid] of peers) {
      if (peerId && expectedUuid && peerUuid === expectedUuid) return peerId
    }
    // Nếu chưa có UUID trong danh bạ, chỉ dùng máy lẻ khi đúng một đối tác có UUID người dùng.
    // Kênh phát tự động không có UUID người dùng nên số máy lẻ hiển thị chưa đủ để xác nhận.
    const [peerId, peerUuid] = peers[0] || []
    if (
      peers.length === 1 &&
      !expectedUuid &&
      typeof peerUuid === 'string' &&
      peerUuid &&
      normalizeExtension(call.peer_caller_id_number) === target
    )
      return peerId
    return ''
  }

  /** Ghi xác nhận người đối thoại của cuộc gọi 1-1 khi event Calld khớp đúng kênh và đích gọi. */
  observeDirectCallPeer(serverCall) {
    const active = callState.activeCall
    if (
      !active ||
      active.direction !== 'outbound' ||
      active.peerConfirmed ||
      this.groupCallService.state.isGroupCall ||
      !this.findConnectedPeer(serverCall, this.currentCallSession, active.number)
    )
      return
    active.peerConfirmed = true
  }

  /** Tra Calld sau ACK SIP để bổ sung trường hợp event bridge đến sớm hoặc bị bỏ lỡ. */
  async confirmDirectCallPeer() {
    const context = captureSessionContext()
    const epoch = this.callGeneration
    const callId = callState.activeCall?.callId
    try {
      const calls = await this.callControlApi.listActiveCalls()
      // Kết quả cũ không được mở nút mời cho cuộc gọi đã thay thế.
      if (
        !isSessionContextCurrent(context) ||
        epoch !== this.callGeneration ||
        callState.activeCall?.callId !== callId
      )
        return
      for (const call of calls) this.observeDirectCallPeer(call)
    } catch (error) {
      logger.warn('CALL', 'Chưa xác nhận được người đối thoại từ Calld.', error)
    }
  }

  /** Hẹn ghi âm tự động cho cuộc gọi hiện tại khi người dùng đã bật tùy chọn và phiên còn hiệu lực. */
  scheduleAutomaticRecording() {
    if (localStorage.getItem('smartcall_auto_record_calls') !== 'true') return
    const callService = this
    const context = captureSessionContext()
    const epoch = this.callGeneration
    const recordingCallId = callState.activeCall?.callId

    /** Bắt đầu ghi âm phía máy chủ sau khi kênh thoại ổn định. */
    async function startAutomaticRecording() {
      const active = callState.activeCall
      // Lệnh ghi âm đến muộn không được tác động lên cuộc gọi hoặc tài khoản mới.
      if (
        !active ||
        epoch !== callService.callGeneration ||
        !isSessionContextCurrent(context) ||
        active.callId !== recordingCallId ||
        callService.recordingService.isRecording()
      )
        return
      try {
        const started = await callService.recordingService.startRecording(null, {
          name: active.name,
          number: active.number,
          extension: active.number,
          dept: active.dept,
          direction: active.direction,
        })
        if (
          started &&
          callState.activeCall?.callId === recordingCallId &&
          epoch === callService.callGeneration
        )
          callState.activeCall.isRecorded = true
      } catch (error) {
        logger.warn('RECORD', 'Không thể tự động kích hoạt ghi âm máy chủ:', error.message)
      }
    }

    setTimeout(startAutomaticRecording, 1200)
  }

  /** Chỉ nhận session trùng SIP ID/object của nhánh chính, incoming hoặc nhánh phụ đang quản lý. */
  isManagedCallSession(session) {
    if (!session) return false
    const callService = this
    const id = this.getSipSessionId(session)
    const sessions = [
      this.currentCallSession,
      callState.activeCall?.session,
      callState.incomingCall?.session,
      callState.incomingCall?.rawSession,
      ...this.groupCallService.state.secondaryCallSessions.values(),
    ]

    /** Đối chiếu một session đang giữ với session cần kiểm tra theo tham chiếu hoặc SIP ID. */
    function matchesManagedSessionItem(item) {
      return Boolean(item && (item === session || (id && callService.getSipSessionId(item) === id)))
    }

    return sessions.some(matchesManagedSessionItem)
  }

  /** SDK có thể phát event đồng bộ trước Promise call; chỉ phát lại nếu ID khớp kết quả thật. */
  acceptManagedCallEvent(kind, session) {
    // Chỉ xử lý event đã khớp nhánh SIP đang quản lý; event tới sớm được giữ tạm, event của nhánh
    // khác bị bỏ qua.
    if (this.isManagedCallSession(session)) return true
    const id = this.getSipSessionId(session)
    if (id && this.pendingSdkCalls > 0) {
      if (this.pendingCallEvents.size >= 20)
        this.pendingCallEvents.delete(this.pendingCallEvents.keys().next().value)
      this.pendingCallEvents.set(kind + ':' + id, { kind, session })
    }
    return false
  }

  /**
   * Gửi lời mời gọi audio-only qua SDK và theo dõi thời gian chờ để event đồng bộ có thể được giữ
   * tạm.
   */
  async requestSdkCall(extension) {
    this.pendingSdkCalls += 1
    try {
      return await this.sdk.Phone.call(extension, false)
    } finally {
      this.pendingSdkCalls -= 1
    }
  }

  /** Phát lại event tới trước Promise call, nhưng chỉ cho SIP ID khớp session SDK vừa trả về. */
  replayPendingCallEvents(session) {
    const id = this.getSipSessionId(session)
    const handlers = {
      progress: '_onProgressHandler',
      accepted: '_onCallAcceptedHandler',
      failed: '_onCallFailedHandler',
      rejected: '_onCallRejectedHandler',
      canceled: '_onCallCanceledHandler',
      ended: '_onCallEndedHandler',
    }
    for (const [kind, handler] of Object.entries(handlers)) {
      const key = kind + ':' + id
      const event = this.pendingCallEvents.get(key)
      this.pendingCallEvents.delete(key)
      if (event) this[handler]?.(event.session)
    }
    if (!this.pendingSdkCalls) this.pendingCallEvents.clear()
  }

  /**
   * Tạo nhánh SIP và gắn nó vào cuộc gọi hiện tại; nếu cuộc gọi/phiên đã đổi thì thu hồi kết quả
   * muộn.
   */
  async placeSdkCall(extension) {
    const sessionContext = captureSessionContext()
    const callEpoch = this.callGeneration
    logger.info('CALL', `📞 Bắt đầu gọi tới số máy lẻ: ${extension} (Audio-only WebRTC)...`)
    try {
      const callId = callState.activeCall?.callId
      const session = await this.requestSdkCall(extension)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (
        !isSessionContextCurrent(sessionContext) ||
        callEpoch !== this.callGeneration ||
        callState.activeCall?.callId !== callId
      ) {
        if (session) await this.sdk.Phone.hangup(session).catch(ignoreCallCleanupRejection)
        throw new Error('Cuộc gọi đã được hủy.')
      }
      if (!session) throw new Error('Kết nối thoại chưa sẵn sàng.')
      this.currentCallSession = session
      this.replayPendingCallEvents(session)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (callEpoch !== this.callGeneration || callState.activeCall?.callId !== callId)
        throw new Error('Cuộc gọi đã kết thúc.')
      logger.info(
        'CALL',
        `Đã tạo yêu cầu gọi tới ${extension}; đang chờ tổng đài phản hồi. Session ID: ${this.currentCallSession?.sipCallId || 'N/A'}`,
      )
      return this.currentCallSession
    } catch (err) {
      logger.error(
        'CALL',
        `Lỗi khi thực hiện cuộc gọi tới ${extension}: ${err.message || err}`,
        err,
      )
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (isSessionContextCurrent(sessionContext) && callEpoch === this.callGeneration)
        this.callToneService.stopAllTones()
      throw err
    }
  }

  /** Cúp cuộc gọi hiện tại; chủ nhóm đồng thời thu hồi hội nghị và các nhánh phụ. */
  hangupCurrentCall(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Cúp máy (Hangup)')
    this.callToneService.stopAllTones()

    // 1. Nếu là Chủ phòng gọi nhóm, giải tán Ad-hoc Conference và ngắt tất cả các nhánh Asterisk
    // của thành viên trước khi đóng phiên gọi chính.
    if (this.groupCallService.state.isGroupCall && this.groupCallService.state.isGroupHost) {
      this._cleanupHostGroupOnHangup(true)
    } else if (
      this.groupCallService.state.isGroupCall &&
      !this.groupCallService.state.isGroupHost
    ) {
      // Nếu là thành viên trong cuộc gọi nhóm, phát thẻ [LEFT:myExt] trước khi cúp máy để các máy
      // khác cập nhật tức thì
      const myExt = this.authService.getCurrentExtension()
      if (myExt) {
        this.authService.updatePresence('available', `[LEFT:${myExt}]`)
      }
    }

    const session = callSession || this.currentCallSession || callState.activeCall?.session
    if (session) {
      try {
        this.sdk.Phone.hangup(session)
      } catch {
        /* SDK có thể báo lỗi nếu nhánh SIP đã ngắt; vẫn chạy finalize để dọn state cục bộ. */
      }
    } else {
      try {
        this.sdk.Phone.hangup()
      } catch {
        /* SDK có thể không còn session giữ; vẫn chạy finalize để dọn state cục bộ. */
      }
    }
    this.finalizeCallTermination('ended', session, true)
  }

  /** Gửi lệnh nghe máy tới SDK; chưa tự đánh dấu cuộc gọi đã connected. */
  async acceptSdkCall(callSession = null) {
    const session = callSession || this.currentCallSession || callState.incomingCall?.session
    if (!session) throw new Error('Cuộc gọi đến không còn khả dụng.')
    this.callToneService.stopAllTones()
    const result = await this.sdk.Phone.accept(session, false)
    if (result == null) throw new Error('Tổng đài chưa chấp nhận thao tác nghe máy.')
    return result
  }

  /** Từ chối session đang đổ chuông bằng SDK. */
  rejectSdkCall(callSession = null) {
    logger.info('CALL', 'Thao tác: Người dùng bấm Từ chối cuộc gọi (Reject)')
    this.callToneService.stopAllTones()
    const session = callSession || this.currentCallSession || callState.incomingCall?.session
    if (session) {
      try {
        this.sdk.Phone.reject(session)
      } catch {
        /* Bỏ qua lỗi reject từ SDK để vẫn dọn sạch state incomingCall qua finalizeCallTermination. */
      }
    }
    this.finalizeCallTermination('rejected', session)
  }

  /** Chuyển sang answering và chờ ACK; giữ lỗi nghe máy khỏi trạng thái connected. */
  async acceptIncomingCall(callData = null) {
    const context = captureSessionContext()
    const incoming = callData || callState.incomingCall
    if (!incoming || callState.activeCall) return false
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    const active = {
      session,
      callId: `rec-${Date.now()}`,
      number: incoming.extension || incoming.number || '',
      name: incoming.name || '',
      dept: incoming.dept || '',
      direction: 'inbound',
      status: 'answering',
      startTime: null,
      duration: 0,
      isMuted: false,
      isRecorded: false,
      isGroupCall: Boolean(this.groupCallService.state.isGroupCall || incoming.isGroupCall),
      isGroupHost: this.groupCallService.state.isGroupHost,
      groupHostExtension:
        this.groupCallService.state.groupHostExtension || incoming.groupHostExtension || '',
      groupParticipantExtensions: this.groupCallService.state.groupParticipantExtensions.length
        ? [...this.groupCallService.state.groupParticipantExtensions]
        : incoming.groupParticipantExtensions || [],
      groupTitle: incoming.groupTitle || '',
    }
    callState.activeCall = active
    this.groupCallService._syncGroupDisplayState()
    callState.incomingCall = null
    try {
      await this.acceptSdkCall(session)
      assertSessionContext(context)
      return callState.activeCall?.callId === active.callId
    } catch (err) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (isSessionContextCurrent(context) && callState.activeCall?.callId === active.callId) {
        this.finalizeCallTermination('failed', session, true)
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: { type: 'error', message: `Không thể nghe máy: ${err.message}` },
          }),
        )
      }
      return false
    }
  }

  /** Từ chối cuộc gọi đến và chạy cleanup qua cùng một vòng đời. */
  rejectIncomingCall(callData = null) {
    const incoming = callData || callState.incomingCall
    if (!incoming) return

    logger.info('CALL', `Từ chối cuộc gọi đến từ máy lẻ: ${incoming.number || incoming.extension}`)
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    this.rejectSdkCall(session)
  }

  /** Kết thúc cuộc gọi không được trả lời và lưu lịch sử tạm trong RAM. */
  missIncomingCall(callData = null) {
    const incoming = callData || callState.incomingCall
    if (!incoming) return

    logger.info(
      'CALL',
      `Cuộc gọi đến từ máy lẻ ${incoming.number || incoming.extension} đã hết hạn (Missed)`,
    )
    const session = incoming.rawSession || incoming.session || this.currentCallSession
    if (session) {
      try {
        this.sdk.Phone.reject(session)
      } catch {
        /* Cuộc gọi đến có thể đã hết hạn bên tổng đài trước khi client gửi reject. */
      }
    }

    this._recordMissedIncomingHistory(incoming, 'Không thể ghi nhận CDR cho cuộc gọi nhỡ:')

    this.currentCallSession = null
    this.phoneAdapter.stopCallAudio()
    callState.incomingCall = null
  }

  /** Kiểm tra điều kiện và bắt đầu cuộc gọi; trả success/reason cho nơi gọi. */
  async startCall(extension, meta = {}) {
    const callService = this
    const context = captureSessionContext(),
      generation = this.callGeneration

    /**
     * Trả kết quả từ chối quay số với mã lý do, chỉ phát toast nếu thao tác vẫn thuộc phiên hiện
     * tại.
     */
    function rejectDial(reason, message) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (message && isSessionContextCurrent(context))
        window.dispatchEvent(new CustomEvent('app-toast', { detail: { type: 'warning', message } }))
      return { success: false, reason }
    }

    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this.isDialing) return rejectDial('THROTTLED', 'Yêu cầu gọi trước đang được xử lý.')
    if (!callState.isRegistered)
      return rejectDial(
        'SIP_NOT_READY',
        'Thoại chưa kết nối với tổng đài. Vui lòng chờ đăng ký SIP thành công.',
      )
    if (this.hasActiveCall())
      return rejectDial('BUSY_LOCAL', 'Vui lòng kết thúc cuộc gọi hiện tại trước.')
    const targetExtension = normalizeExtension(extension)
    if (!targetExtension) return rejectDial('EMPTY_EXTENSION')
    if (targetExtension === normalizeExtension(this.authService.getCurrentExtension()))
      return rejectDial('SELF_CALL', 'Không thể gọi tới chính máy lẻ của bạn.')
    const attempt = ++this.dialingAttempt,
      startedAt = Date.now()
    this.isDialing = true
    try {
      let target = this.contactService.findContactByExtension(targetExtension)
      const verifyTarget = !meta.allowUnknown || Boolean(meta.expectedUuid)
      if (verifyTarget)
        target = await this.contactService.getOrLookupContact(targetExtension, {
          fresh: true,
          ...(meta.expectedUuid ? { expectedUuid: meta.expectedUuid } : {}),
        })
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(context) || generation !== this.callGeneration)
        return rejectDial('CANCELED')
      if (this.hasActiveCall())
        return rejectDial('BUSY_LOCAL', 'Đã có cuộc gọi khác đang hoạt động.')
      if (!target && !meta.allowUnknown)
        return rejectDial('TARGET_NOT_FOUND', 'Không tìm thấy máy lẻ trong danh bạ hệ thống.')
      if (meta.expectedUuid && target?.uuid !== meta.expectedUuid)
        return rejectDial(
          'TARGET_CHANGED',
          'Máy lẻ đã đổi người sử dụng. Vui lòng tìm và chọn lại.',
        )
      let targetForPolicy = target
      if (target) {
        const status = await this.contactService.confirmCallTargetPresence(target)
        // Trong lúc chờ presence, phiên có thể đổi hoặc người dùng đã hủy yêu cầu gọi.
        if (!isSessionContextCurrent(context) || generation !== this.callGeneration)
          return rejectDial('CANCELED')
        if (status === 'unknown')
          return rejectDial(
            'TARGET_STATUS_UNKNOWN',
            'Chưa xác minh được trạng thái người nhận. Vui lòng thử lại.',
          )
        targetForPolicy = { ...target, status }
      }
      const restriction = getContactCallRestriction(targetForPolicy)
      if (restriction) return rejectDial(restriction.reason, restriction.message)
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!devices.some(isAudioInputDevice))
          return rejectDial('NO_MIC', 'Không tìm thấy microphone. Vui lòng cắm mic hoặc tai nghe.')
      }
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(context) || generation !== this.callGeneration)
        return rejectDial('CANCELED')
      if (this.hasActiveCall())
        return rejectDial('BUSY_LOCAL', 'Đã có cuộc gọi khác đang hoạt động.')
      if (!callState.isRegistered)
        return rejectDial('SIP_NOT_READY', 'Kết nối thoại vừa bị ngắt. Vui lòng thử lại sau.')
      const localCallId = 'call-' + crypto.randomUUID()
      callState.activeCall = {
        session: null,
        callId: localCallId,
        number: targetExtension,
        peerUuid: target?.uuid || '',
        name: meta.name || target?.name || 'Máy lẻ ' + targetExtension,
        dept: meta.dept || target?.dept || '',
        direction: 'outbound',
        status: 'ringing',
        startTime: null,
        duration: 0,
        isMuted: false,
        isRecorded: false,
        isGroupCall: Boolean(meta.isGroupCall || this.groupCallService.state.isGroupCall),
        isGroupHost: Boolean(meta.isGroupHost || this.groupCallService.state.isGroupHost),
        groupHostExtension:
          meta.groupHostExtension || this.groupCallService.state.groupHostExtension,
        groupParticipantExtensions:
          meta.groupParticipants || this.groupCallService.state.groupParticipantExtensions || [],
        groupTitle: meta.groupTitle || '',
      }
      this.callToneService.startRingbackTone()
      try {
        const session = await this.placeSdkCall(targetExtension)
        // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác
        // để đổi state.
        if (callState.activeCall?.callId === localCallId) callState.activeCall.session = session
        return { success: true, session }
      } catch (error) {
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (isSessionContextCurrent(context) && callState.activeCall?.callId === localCallId) {
          this.finalizeCallTermination('failed', null, true)
          window.dispatchEvent(
            new CustomEvent('app-toast', {
              detail: { type: 'error', message: 'Không thể bắt đầu cuộc gọi: ' + error.message },
            }),
          )
        }
        return {
          success: false,
          reason: isSessionContextCurrent(context) ? 'SDK_ERROR' : 'CANCELED',
          error,
        }
      }
    } catch (error) {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (isSessionContextCurrent(context)) return rejectDial('LOOKUP_ERROR', error.message)
      return rejectDial('CANCELED')
    } finally {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (isSessionContextCurrent(context) && attempt === this.dialingAttempt) {
        clearTimeout(this.dialingReleaseTimer)
        const delay = Math.max(0, 1200 - (Date.now() - startedAt))

        /** Mở khóa quay số sau khoảng chống bấm đè nếu không có lượt quay mới hơn. */
        function releaseDialLock() {
          if (attempt === callService.dialingAttempt) callService.isDialing = false
        }

        if (delay) this.dialingReleaseTimer = setTimeout(releaseDialLock, delay)
        else this.isDialing = false
      }
    }
  }

  /** Hủy trạng thái quay số đang chờ; callback cũ không được mở khóa lượt mới. */
  cancelPendingDial() {
    this.dialingAttempt++
    clearTimeout(this.dialingReleaseTimer)
    this.dialingReleaseTimer = null
    this.isDialing = false
  }

  /** Áp dụng trạng thái tắt/bật microphone cho session hiện tại. */
  setMute(isMuted, callSession = null) {
    const session = callSession || this.currentCallSession || callState.activeCall?.session
    if (session) {
      try {
        if (isMuted) {
          this.sdk.Phone.mute(session)
          logger.info('CALL', 'Đã tắt Microphone (Mute)')
        } else {
          this.sdk.Phone.unmute(session)
          logger.info('CALL', 'Đã bật lại Microphone (Unmute)')
        }
      } catch (e) {
        logger.warn('CALL', 'Lỗi chuyển trạng thái Mic:', e)
      }
    }
  }

  /** Đảo trạng thái microphone và cập nhật thông báo cho người dùng. */
  toggleMute() {
    if (!callState.activeCall) return
    callState.activeCall.isMuted = !callState.activeCall.isMuted
    this.setMute(callState.activeCall.isMuted, callState.activeCall.session)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: callState.activeCall.isMuted
            ? '🔇 Đã tắt Microphone (Mute).'
            : '🎙️ Đã bật lại Microphone (Unmute).',
          type: 'info',
        },
      }),
    )
  }

  /** Gửi phím DTMF tới session đang đàm thoại. */
  sendDtmfDigits(tone, callSession = null) {
    const session = callSession || this.currentCallSession || callState.activeCall?.session
    if (session) {
      try {
        if (typeof this.sdk.Phone.sendDTMF === 'function') {
          this.sdk.Phone.sendDTMF(tone, session)
        } else if (typeof session.sendDtmf === 'function') {
          session.sendDtmf(tone)
        }
        logger.info('CALL', `Đã gửi tín hiệu DTMF [${tone}] qua WebRTC tới máy chủ Asterisk.`)
      } catch (e) {
        logger.warn('CALL', `Lỗi gửi tín hiệu DTMF [${tone}]:`, e)
      }
    }
  }

  /** Kiểm tra có cuộc gọi đang xử lý để chặn các thao tác xung đột. */
  hasActiveCall() {
    return Boolean(this.currentCallSession || callState.activeCall)
  }

  /** Chuyển lệnh tắt microphone tới SDK cho session được chỉ định. */
  mute(callSession = null) {
    this.setMute(true, callSession)
  }
}
