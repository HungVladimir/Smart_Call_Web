import { normalizeExtension, getContactCallRestriction } from '../../utils/callPolicy.js'
import { createPhoneEventHandlers } from './phoneEvents.js'
import {
  captureSessionContext,
  assertSessionContext,
  isSessionContextCurrent,
} from '../auth/sessionScope.js'
import { callState } from '../../state/callState.js'
import { logger } from '../common/loggerService.js'

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

  /** Đọc hoặc cập nhật khóa chống quay số trùng trong state cuộc gọi. */
  get isDialing() {
    return callState.dialing
  }

  /** Đọc hoặc cập nhật khóa chống quay số trùng trong state cuộc gọi. */
  set isDialing(value) {
    callState.dialing = value
  }

  /** Gộp các yêu cầu kết nối thoại đồng thời và đợi lệnh SDK hoàn tất. */
  connect() {
    if (!this.authService.isAuthenticated())
      return Promise.reject(new Error('Cần đăng nhập trước khi kết nối thoại.'))
    if (callState.isRegistered) return Promise.resolve(true)
    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this.connectPromise) return this.connectPromise
    const context = captureSessionContext()
    const generation = ++this.connectionGeneration
    this.connectPromise = (async () => {
      try {
        // SDK disconnect đóng phone sau await; không kết nối mới khi cleanup cũ còn chạy.
        if (this.disconnectionPromise) await this.disconnectionPromise
        assertSessionContext(context)
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (generation !== this.connectionGeneration) throw new Error('Kết nối thoại đã bị hủy.')
        // Đăng ký trước connect để không bỏ lỡ ON_REGISTERED phát ngay.
        this.attachPhoneListeners()
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
        await this.phoneAdapter.applyAudioDevices()
        assertSessionContext(context)
        // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu
        // đến muộn sau hủy/đổi phiên.
        if (generation !== this.connectionGeneration) throw new Error('Kết nối thoại đã bị hủy.')
        this.phoneAdapter.disableSdkAutomaticHold()
        logger.success(
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
    })().finally(() => {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (generation === this.connectionGeneration) this.connectPromise = null
    })
    return this.connectPromise
  }

  /** Hủy kết nối đang chờ, gỡ listener và dừng tài nguyên âm thanh. */
  disconnect() {
    this.connectionGeneration += 1
    this.connectPromise = null
    this.cancelPendingDial()
    try {
      callState.isRegistered = false
      this.phoneAdapter.stopCallAudio()
      this.callToneService.stopAllTones()

      // BUG-06: Gỡ bỏ phòng vệ toàn bộ listener của Wazo.Phone trước khi disconnect
      this.detachPhoneListeners()

      if (this.sdk && this.sdk.Phone && typeof this.sdk.Phone.disconnect === 'function') {
        const cleanup = this.sdk.Phone.disconnect()
        this.disconnectionPromise = Promise.resolve(cleanup).catch((error) => {
          logger.warn('SIP', 'Không hoàn tất ngắt kết nối SDK:', error.message)
        })
      }
      logger.info('SIP', 'Đã ngắt kết nối Wazo WebRTC Phone')
    } catch (e) {
      logger.warn('SIP', 'Lỗi khi ngắt kết nối Wazo WebRTC Phone:', e)
    } finally {
      this.listenersAttached = false
    }
    return this.disconnectionPromise
  }

  /** Đếm thời lượng từ thời điểm cuộc gọi thực sự được kết nối. */
  startCallDurationTimer() {
    this.stopCallDurationTimer()
    this._durationInterval = setInterval(() => {
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
    }, 1000)
  }

  /** Dừng đồng hồ đàm thoại khi nhánh gọi hoặc cuộc gọi kết thúc. */
  stopCallDurationTimer() {
    if (this._durationInterval) {
      clearInterval(this._durationInterval)
      this._durationInterval = null
    }
  }

  /** Kết thúc đúng nhánh hoặc toàn cuộc gọi và thu hồi tài nguyên liên quan. */
  finalizeCallTermination(reason = 'ended', session = null, forceEnd = false) {
    // 1. Kiểm tra nếu cuộc gọi nhóm đang diễn ra và chỉ có 1 nhánh phụ bị ngắt (không forceEnd)
    if (
      !forceEnd &&
      this.groupCallService.state.isGroupCall &&
      this.groupCallService.state.isGroupHost &&
      session
    ) {
      const endedSipId = session.sipCallId || (session.getId && session.getId()) || session.id
      let endedSecExt = null
      for (const [ext, secSession] of this.groupCallService.state.secondaryCallSessions.entries()) {
        const secSipId =
          secSession.sipCallId || (secSession.getId && secSession.getId()) || secSession.id
        // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác
        // để đổi state.
        if (
          secSession === session ||
          (endedSipId && secSipId && String(secSipId) === String(endedSipId))
        ) {
          endedSecExt = ext
          break
        }
      }

      // Nhận diện thêm nếu SIP ID nằm trong danh sách đang hủy do timeout
      const isMarkedTerminating =
        endedSipId && this.groupCallService._terminatingSecondarySipIds.has(String(endedSipId))
      if (isMarkedTerminating && endedSipId) {
        this.groupCallService._terminatingSecondarySipIds.delete(String(endedSipId))
      }

      if (endedSecExt || isMarkedTerminating) {
        if (endedSecExt) {
          this.groupCallService.clearParticipantInviteTimeout(endedSecExt)
          this.groupCallService.state.secondaryCallSessions.delete(endedSecExt)

          // Nếu đã có Ad-hoc Conference hoạt động và không phải nhánh timeout, nhánh SIP phụ
          // WebRTC kết thúc do Asterisk chuyển kênh sang ConfBridge
          // -> Tuyệt đối KHÔNG xóa thành viên khỏi nhóm (Đối chiếu WazoSipCallManager.py line
          // 1164)
          if (this.groupCallService.state.activeAdhocConferenceId && !isMarkedTerminating) {
            logger.info(
              'CALL',
              `Nhánh WebRTC phụ [${endedSecExt}] đã chuyển giao sang Ad-hoc Conference [${this.groupCallService.state.activeAdhocConferenceId}]. Tiếp tục duy trì thành viên trong nhóm.`,
            )
            return
          }

          logger.warn(
            'CALL',
            `Nhánh phụ [${endedSecExt}] kết thúc (${reason}). Gỡ khỏi nhóm và duy trì các nhánh còn lại.`,
          )
          const childCallId = this.groupCallService.state.extensionToWazoCallIdMap.get(endedSecExt)
          if (childCallId) {
            this.callControlApi.hangupServerCall(childCallId).catch(() => {})
            this.groupCallService.state.extensionToWazoCallIdMap.delete(endedSecExt)
            this.groupCallService.state.mergedCallIds.delete(childCallId)
          }
          this.groupCallService.state.groupParticipantExtensions =
            this.groupCallService.state.groupParticipantExtensions.filter((e) => e !== endedSecExt)
          if (callState.activeCall) {
            callState.activeCall.groupParticipantExtensions = [
              ...this.groupCallService.state.groupParticipantExtensions,
            ]
            callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupCallService.state.groupParticipantExtensions.length} người)`
            if (callState.activeCall.number === endedSecExt) {
              const myExt = this.authService.getCurrentExtension()
              const remainingOthers = this.groupCallService.state.groupParticipantExtensions.filter(
                (e) => e !== myExt,
              )
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

        // KIỂM TRA ĐIỀU KIỆN KẾT THÚC CUỘC GỌI NHÓM:
        // Chỉ khi KHÔNG còn ai đang kết nối (đàm thoại) VÀ KHÔNG còn nhánh phụ nào đang đổ chuông
        // VÀ nhánh chính không còn đổ chuông
        const myExt = this.authService.getCurrentExtension()
        const remainingOthers = this.groupCallService.state.groupParticipantExtensions.filter(
          (e) => e !== myExt,
        )
        if (
          this.groupCallService.isAnyParticipantConnected() ||
          this.groupCallService.state.secondaryCallSessions.size > 0 ||
          (this.currentCallSession &&
            remainingOthers.length > 0 &&
            callState.activeCall?.status === 'ringing')
        ) {
          logger.info(
            'CALL',
            'Vẫn còn thành viên đang hoạt động hoặc đang đổ chuông trong nhóm. Duy trì cuộc gọi!',
          )
          return // Không cúp cuộc gọi chính!
        }
        logger.warn(
          'CALL',
          'Tất cả thành viên trong nhóm đều đã ngắt kết nối hoặc không nghe máy. Kết thúc cuộc gọi.',
        )
      }

      // 2. Nếu nhánh chính (primary) kết thúc nhưng vẫn còn các nhánh phụ đang hoạt động
      const primarySipId =
        this.currentCallSession?.sipCallId ||
        (this.currentCallSession?.getId && this.currentCallSession.getId()) ||
        this.currentCallSession?.id
      // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
      // đổi state.
      if (
        session === this.currentCallSession ||
        (endedSipId && primarySipId && String(primarySipId) === String(endedSipId))
      ) {
        this.groupCallService.clearPrimaryInviteTimeout()
        if (this.groupCallService.state.secondaryCallSessions.size > 0) {
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

          // Gỡ số máy nhánh chính cũ khỏi groupParticipantExtensions
          if (oldPrimaryExt) {
            this.groupCallService.state.groupParticipantExtensions =
              this.groupCallService.state.groupParticipantExtensions.filter(
                (e) => e !== oldPrimaryExt,
              )
            const childCallId =
              this.groupCallService.state.extensionToWazoCallIdMap.get(oldPrimaryExt)
            if (childCallId) {
              this.callControlApi.hangupServerCall(childCallId).catch(() => {})
              this.groupCallService.state.extensionToWazoCallIdMap.delete(oldPrimaryExt)
              this.groupCallService.state.mergedCallIds.delete(childCallId)
            }
          }
          if (callState.activeCall) {
            callState.activeCall.groupParticipantExtensions = [
              ...this.groupCallService.state.groupParticipantExtensions,
            ]
            callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.groupCallService.state.groupParticipantExtensions.length} người)`
          }
          window.dispatchEvent(
            new CustomEvent('app-toast', {
              detail: {
                message: `⚠️ Nhánh máy lẻ ${oldPrimaryExt || 'chính'} không thể kết nối hoặc đã kết thúc`,
                type: 'warning',
              },
            }),
          )
          this.groupCallService.broadcastGroupStateViaPresence()
          this.groupCallService.broadcastNoticeToGroup(
            `Nhánh máy lẻ ${oldPrimaryExt} không thể kết nối hoặc đã kết thúc`,
          )
          return // Không cúp cuộc gọi chính!
        } else if (this.groupCallService.isAnyParticipantConnected()) {
          logger.info(
            'CALL',
            'Nhánh chính WebRTC chuyển trạng thái nhưng cuộc gọi nhóm vẫn đang kết nối thành viên. Duy trì cuộc gọi.',
          )
          return // Không cúp cuộc gọi chính!
        }
      }
    }

    // BUG-05: Session guard: Ngăn chặn kết thúc nhầm activeCall khi sự kiện kết thúc thuộc về
    // phiên gọi khác
    if (!forceEnd && session && callState.activeCall?.session) {
      const activeSession = callState.activeCall.session
      const activeSipId =
        activeSession.sipCallId ||
        (typeof activeSession.getId === 'function' && activeSession.getId()) ||
        activeSession.id
      const endedSipId =
        session.sipCallId || (typeof session.getId === 'function' && session.getId()) || session.id

      // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi khác để
      // đổi state.
      if (activeSipId && endedSipId && String(activeSipId) !== String(endedSipId)) {
        logger.warn(
          'CALL',
          `🛡️ Bỏ qua _finalizeCallTermination: Session kết thúc (${endedSipId}) không khớp với activeCall (${activeSipId}).`,
        )
        // Dọn dẹp incomingCall nếu phiên kết thúc thuộc về incomingCall
        if (callState.incomingCall) {
          const incSession = callState.incomingCall.session || callState.incomingCall.rawSession
          const incSipId = incSession
            ? incSession.sipCallId ||
              (typeof incSession.getId === 'function' && incSession.getId()) ||
              incSession.id
            : null
          // Đối chiếu ID nhánh/hội nghị hiện tại; không dùng sự kiện hoặc kết quả của cuộc gọi
          // khác để đổi state.
          if (!incSipId || String(incSipId) === String(endedSipId)) {
            const inc = callState.incomingCall
            try {
              this.historyService.addRecord({
                name:
                  inc.name ||
                  (inc.extension || inc.number
                    ? `Máy lẻ ${inc.extension || inc.number}`
                    : 'Đồng nghiệp'),
                extension: inc.extension || inc.number || '',
                dept: inc.dept || '',
                duration: 0,
                direction: 'inbound',
                status: 'missed',
                answered: false,
              })
            } catch (e) {}
            callState.incomingCall = null
            this.callToneService.stopIncomingRingtone()
          }
        }
        return
      }
    }

    this.cancelPendingDial()
    this.recordingService.cancelPendingStart()
    const active = callState.activeCall
    const incoming = callState.incomingCall

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

      if (this.recordingService.isRecording()) {
        try {
          this.recordingService
            .stopRecording()
            .catch((err) => logger.warn('RECORD', 'Chưa xác nhận dừng ghi âm:', err.message))
        } catch (recErr) {
          logger.warn('RECORD', 'Lỗi dừng ghi âm máy chủ:', recErr)
        }
      }

      try {
        this.historyService.addRecord({
          name: active.name || (active.number ? `Máy lẻ ${active.number}` : 'Đồng nghiệp'),
          extension: active.number || '',
          dept: active.dept || '',
          duration: finalDuration,
          direction: active.direction || 'outbound',
          status: status,
          answered: wasConnected,
        })
      } catch (cdrErr) {
        logger.warn('CALL', 'Không thể ghi nhận CDR cho cuộc gọi hoạt động:', cdrErr)
      }
    } else if (incoming) {
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
        logger.warn('CALL', 'Không thể ghi nhận CDR cho cuộc gọi nhỡ:', cdrErr)
      }
    }

    this.stopCallDurationTimer()
    this.currentCallSession = null
    this.phoneAdapter.stopCallAudio()
    this.callToneService.stopAllTones()

    // Dọn dẹp Ad-hoc Group Call nếu phiên này là Chủ phòng (Bám sát Android lines 2055-2062)
    if (this.groupCallService.state.isGroupCall && this.groupCallService.state.isGroupHost) {
      this.groupCallService.clearAllParticipantInviteTimeouts()
      this.groupCallService.clearPrimaryInviteTimeout()
      if (this.groupCallService.state.activeAdhocConferenceId) {
        this.callControlApi
          .deleteConference(this.groupCallService.state.activeAdhocConferenceId)
          .catch(() => {})
      }
      const childCallIds = Array.from(this.groupCallService.state.extensionToWazoCallIdMap.values())
      for (const cId of childCallIds) {
        if (cId) {
          this.callControlApi.hangupServerCall(cId).catch(() => {})
        }
      }
      for (const [, secSession] of this.groupCallService.state.secondaryCallSessions.entries()) {
        try {
          this.sdk.Phone.hangup(secSession)
        } catch (e) {
          /* ignore */
        }
      }
      this.groupCallService.state.secondaryCallSessions.clear()
    }
    this.groupCallService.resetGroupState()
    try {
      this.authService.updatePresence('available', this.authService.mySessionId)
    } catch (e) {
      /* ignore */
    }

    if (active || incoming) {
      this.callToneService.playCallEndedTone()
    }

    callState.activeCall = null
    callState.incomingCall = null

    window.dispatchEvent(new CustomEvent('wazo-ended', { detail: session }))
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
          } catch (e) {
            /* ignore */
          }
          try {
            if (
              this.sdk.Phone.eventEmitter &&
              typeof this.sdk.Phone.eventEmitter.removeAllListeners === 'function'
            ) {
              this.sdk.Phone.eventEmitter.removeAllListeners(evt)
            }
          } catch (e) {
            /* ignore */
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

  /** Gửi lệnh gọi audio qua SDK và hủy session nếu cuộc gọi đã hết hiệu lực. */
  /** Nhận diện một nhánh bằng SIP ID, không dựa vào số điện thoại hoặc thời điểm nhận event. */
  getSipSessionId(session) {
    try {
      return String(session?.sipCallId || session?.getId?.() || session?.id || '')
    } catch {
      return ''
    }
  }

  /** Chỉ nhận session trùng SIP ID/object của nhánh chính, incoming hoặc nhánh phụ đang quản lý. */
  isManagedCallSession(session) {
    if (!session) return false
    const id = this.getSipSessionId(session)
    const sessions = [
      this.currentCallSession,
      callState.activeCall?.session,
      callState.incomingCall?.session,
      callState.incomingCall?.rawSession,
      ...this.groupCallService.state.secondaryCallSessions.values(),
    ]
    return sessions.some(
      (item) => item && (item === session || (id && this.getSipSessionId(item) === id)),
    )
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
        if (session) await this.sdk.Phone.hangup(session).catch(() => {})
        throw new Error('Cuộc gọi đã được hủy.')
      }
      if (!session) throw new Error('Kết nối thoại chưa sẵn sàng.')
      this.currentCallSession = session
      this.replayPendingCallEvents(session)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (callEpoch !== this.callGeneration || callState.activeCall?.callId !== callId)
        throw new Error('Cuộc gọi đã kết thúc.')
      logger.success(
        'CALL',
        `Tín hiệu cuộc gọi tới ${extension} đã được phát đi. Session ID: ${this.currentCallSession?.sipCallId || 'N/A'}`,
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
    // của thành viên
    // (Bám sát 100% Android WazoSipCallManager.py lines 2044-2062)
    if (this.groupCallService.state.isGroupCall && this.groupCallService.state.isGroupHost) {
      this.groupCallService.clearAllParticipantInviteTimeouts()
      this.groupCallService.clearPrimaryInviteTimeout()
      if (this.groupCallService.state.activeAdhocConferenceId) {
        this.callControlApi
          .deleteConference(this.groupCallService.state.activeAdhocConferenceId)
          .catch(() => {})
      }
      const childCallIds = Array.from(this.groupCallService.state.extensionToWazoCallIdMap.values())
      for (const cId of childCallIds) {
        if (cId) {
          this.callControlApi.hangupServerCall(cId).catch(() => {})
        }
      }
      for (const [, secSession] of this.groupCallService.state.secondaryCallSessions.entries()) {
        try {
          this.sdk.Phone.hangup(secSession)
        } catch (e) {
          /* ignore */
        }
      }
      this.groupCallService.state.secondaryCallSessions.clear()
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
      } catch (e) {
        /* ignore */
      }
    } else {
      try {
        this.sdk.Phone.hangup()
      } catch (e) {
        /* ignore */
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
      } catch (e) {
        /* ignore */
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
      } catch (e) {}
    }

    try {
      this.historyService.addRecord({
        name: incoming.name || `Máy lẻ ${incoming.extension || incoming.number}`,
        extension: incoming.extension || incoming.number || '',
        dept: incoming.dept || '',
        duration: 0,
        direction: 'inbound',
        status: 'missed',
        answered: false,
      })
    } catch (e) {}

    this.currentCallSession = null
    this.phoneAdapter.stopCallAudio()
    callState.incomingCall = null
  }

  /** Kiểm tra điều kiện và bắt đầu cuộc gọi; trả success/reason cho nơi gọi. */
  async startCall(extension, meta = {}) {
    const context = captureSessionContext(),
      generation = this.callGeneration
    /**
     * Trả kết quả từ chối quay số với mã lý do, chỉ phát toast nếu thao tác vẫn thuộc phiên hiện
     * tại.
     */
    const reject = (reason, message) => {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (message && isSessionContextCurrent(context))
        window.dispatchEvent(new CustomEvent('app-toast', { detail: { type: 'warning', message } }))
      return { success: false, reason }
    }
    // Dùng tác vụ đang chờ hoặc chặn thao tác trùng để tránh tạo nhiều request/SDK session song
    // song.
    if (this.isDialing) return reject('THROTTLED', 'Yêu cầu gọi trước đang được xử lý.')
    if (this.hasActiveCall())
      return reject('BUSY_LOCAL', 'Vui lòng kết thúc cuộc gọi hiện tại trước.')
    const targetExtension = normalizeExtension(extension)
    if (!targetExtension) return reject('EMPTY_EXTENSION')
    if (targetExtension === normalizeExtension(this.authService.getCurrentExtension()))
      return reject('SELF_CALL', 'Không thể gọi tới chính máy lẻ của bạn.')
    const attempt = ++this.dialingAttempt,
      startedAt = Date.now()
    this.isDialing = true
    try {
      let target = this.contactService.findContactByExtension(targetExtension)
      if (!target && !meta.allowUnknown)
        target = await this.contactService.getOrLookupContact(targetExtension)
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(context) || generation !== this.callGeneration)
        return reject('CANCELED')
      if (this.hasActiveCall()) return reject('BUSY_LOCAL', 'Đã có cuộc gọi khác đang hoạt động.')
      if (!target && !meta.allowUnknown)
        return reject('TARGET_NOT_FOUND', 'Không tìm thấy máy lẻ trong danh bạ hệ thống.')
      const restriction = getContactCallRestriction(target)
      if (restriction) return reject(restriction.reason, restriction.message)
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!devices.some((device) => device.kind === 'audioinput'))
          return reject('NO_MIC', 'Không tìm thấy microphone. Vui lòng cắm mic hoặc tai nghe.')
      }
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (!isSessionContextCurrent(context) || generation !== this.callGeneration)
        return reject('CANCELED')
      if (this.hasActiveCall()) return reject('BUSY_LOCAL', 'Đã có cuộc gọi khác đang hoạt động.')
      const localCallId = 'call-' + crypto.randomUUID()
      callState.activeCall = {
        session: null,
        callId: localCallId,
        number: targetExtension,
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
      if (isSessionContextCurrent(context)) return reject('LOOKUP_ERROR', error.message)
      return reject('CANCELED')
    } finally {
      // Chỉ tác vụ/callback còn thuộc đúng phiên và đúng thế hệ được dùng kết quả; bỏ dữ liệu đến
      // muộn sau hủy/đổi phiên.
      if (isSessionContextCurrent(context) && attempt === this.dialingAttempt) {
        clearTimeout(this.dialingReleaseTimer)
        const delay = Math.max(0, 1200 - (Date.now() - startedAt))
        if (delay)
          this.dialingReleaseTimer = setTimeout(() => {
            if (attempt === this.dialingAttempt) this.isDialing = false
          }, delay)
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
