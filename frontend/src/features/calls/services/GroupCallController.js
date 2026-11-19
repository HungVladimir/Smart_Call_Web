import {
  captureSessionContext,
  isSessionContextCurrent,
} from '../../../core/session/sessionScope.js'
import { callState } from '../state/callState.js'

import { logger } from '../../../core/logging/LoggerService.js'
import { createGroupCallState } from '../state/groupCallState.js'

/** Điều phối hội nghị và các nhánh gọi; dùng AuthService để lấy thông tin phiên. */
export class GroupCallController {
  constructor({
    sdk,
    authService,
    callController,
    contactService,
    callControlApi,
    phoneAdapter,
    callToneService,
  }) {
    Object.assign(this, {
      sdk,
      authService,
      callController,
      contactService,
      callControlApi,
      phoneAdapter,
      callToneService,
    })
    this.state = createGroupCallState()
    this._adhocRetryCount = 0
    this._syncAdhocRetryTimer = null
    this._terminatingSecondarySipIds = new Set()
    this._isSyncingAdhoc = false
    this._syncAdhocDebounceTimer = null
    this._secondaryInviteTimers = new Map()
    this._primaryInviteTimer = null
    this._processedAddReqIds = new Set()
    this._processedNoticeIds = new Set()
  }

  /** Hẹn đồng bộ lại hội nghị khi các server call ID chưa sẵn sàng. */
  scheduleConferenceRetry(epoch) {
    if (this._syncAdhocRetryTimer || this._adhocRetryCount >= 3) return
    this._adhocRetryCount += 1
    this._syncAdhocRetryTimer = setTimeout(() => {
      this._syncAdhocRetryTimer = null
      if (epoch === this.callController.callGeneration) this.syncActiveCallsToAdhocConference()
    }, 500 * this._adhocRetryCount)
  }

  /** Khởi tạo nhóm từ máy lẻ thật và mời các nhánh còn lại theo thế hệ cuộc gọi. */
  async startGroupCall(targetExtensions = [], meta = {}) {
    const sessionContext = captureSessionContext()
    // BUG-08: Anti-collision check ngăn chặn xung đột khi đang trong cuộc gọi hoặc bấm nhanh liên tục
    if (
      this.state.isGroupCall ||
      this.callController.hasActiveCall() ||
      callState.activeCall ||
      this.callController.isDialing
    ) {
      logger.warn(
        'CALL',
        'Chặn bắt đầu gọi nhóm: Đã có cuộc gọi đang hoạt động hoặc cuộc gọi nhóm đang diễn ra (already_in_call).',
      )
      return { success: false, reason: 'already_in_call' }
    }

    if (!targetExtensions || targetExtensions.length === 0)
      return { success: false, reason: 'EMPTY' }

    const myExt = this.authService.getCurrentExtension()
    const cleanList = []
    for (const ext of targetExtensions) {
      const s = String(ext || '').trim()
      if (s && s !== myExt && !cleanList.includes(s)) {
        cleanList.push(s)
      }
    }

    if (cleanList.length === 0) {
      logger.warn('CALL', 'Danh sách máy lẻ hợp lệ để gọi nhóm rỗng.')
      return { success: false, reason: 'NO_VALID_TARGETS' }
    }

    // Lọc loại bỏ các máy lẻ đang bận (talking/holding), đang đổ chuông (ringing/progressing), không làm phiền (dnd) hoặc offline
    const availableTargets = []
    const busyTargets = []
    for (const ext of cleanList) {
      if (this.contactService.isContactAvailableForCall(ext)) {
        availableTargets.push(ext)
      } else {
        const c = this.contactService.findContactByExtension(ext)
        busyTargets.push(c?.name ? `${c.name} (${ext})` : `Máy lẻ ${ext}`)
      }
    }

    if (busyTargets.length > 0) {
      logger.warn(
        'CALL',
        `Các máy lẻ bận/không khả dụng bị loại khỏi gọi nhóm: ${busyTargets.join(', ')}`,
      )
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ [${busyTargets.join(', ')}] hiện đang bận hoặc không khả dụng để gọi nhóm! Đã tự động loại bỏ.`,
            type: 'warning',
          },
        }),
      )
    }

    if (availableTargets.length === 0) {
      logger.warn('CALL', 'Không còn máy lẻ nào khả dụng để bắt đầu cuộc gọi nhóm.')
      return { success: false, reason: 'NO_AVAILABLE_TARGETS' }
    }

    if (availableTargets.length === 1) {
      logger.info(
        'CALL',
        `Chỉ còn 1 máy lẻ khả dụng [${availableTargets[0]}]. Chuyển sang cuộc gọi thoại 1-1.`,
      )
      return this.callController.startCall(availableTargets[0], meta)
    }

    logger.info(
      'CALL',
      `👥 Bắt đầu gọi nhóm (Ad-hoc) tới ${availableTargets.length} thành viên khả dụng: ${availableTargets.join(', ')}`,
    )

    // Thiết lập trạng thái Host & Group
    this.state.isGroupHost = true
    this.state.groupHostExtension = myExt
    this.state.isGroupCall = true
    this.state.activeAdhocConferenceId = ''
    this.state.extensionToWazoCallIdMap.clear()
    this.state.mergedCallIds.clear()
    this.state.secondaryCallSessions.clear()

    this.state.groupParticipantExtensions = [myExt, ...availableTargets]
    const callEpoch = this.callController.callGeneration

    const firstTarget = availableTargets[0]
    const remainingTargets = availableTargets.slice(1)

    // Khởi tạo cuộc gọi nhánh đầu tiên
    const callResult = await this.callController.startCall(firstTarget, {
      ...meta,
      isGroupCall: true,
      isGroupHost: true,
      groupHostExtension: myExt,
      groupTitle:
        meta.groupTitle || `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`,
      groupParticipants: this.state.groupParticipantExtensions,
    })

    if (
      !isSessionContextCurrent(sessionContext) ||
      callEpoch !== this.callController.callGeneration
    )
      return { success: false, reason: 'CANCELED' }
    if (!callResult || !callResult.success) {
      this.resetGroupState()
      return callResult
    }

    // Đặt bộ đếm Timeout 30 giây cho nhánh chính đầu tiên
    this.startPrimaryInviteTimeout(firstTarget)

    // Đánh dấu activeCall là groupCall
    if (callState.activeCall) {
      callState.activeCall.isGroupCall = true
      callState.activeCall.isGroupHost = true
      callState.activeCall.groupHostExtension = myExt
      callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
      callState.activeCall.groupTitle =
        meta.groupTitle || `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`
    }

    // Sau 700ms (khi nhánh đầu tiên đã sẵn sàng SDP), gọi các nhánh còn lại
    setTimeout(() => {
      if (
        !isSessionContextCurrent(sessionContext) ||
        callEpoch !== this.callController.callGeneration
      )
        return
      if (
        this.callController.hasActiveCall() &&
        this.state.isGroupCall &&
        remainingTargets.length > 0
      ) {
        this.addParticipantsToGroupCall(remainingTargets).catch((err) =>
          logger.warn('CALL', 'Không thể mời thành viên:', err.message),
        )
      }
    }, 700)

    // Phát trạng thái nhóm lên Presence
    this.broadcastGroupStateViaPresence()

    return { success: true }
  }

  /** Kiểm tra và gọi thêm các máy lẻ vào nhóm hiện tại. */
  async addParticipantsToGroupCall(extensions = []) {
    const sessionContext = captureSessionContext()
    const callEpoch = this.callController.callGeneration
    const callId = callState.activeCall?.callId
    const current = () =>
      isSessionContextCurrent(sessionContext) &&
      callEpoch === this.callController.callGeneration &&
      callState.activeCall?.callId === callId
    if (!callState.activeCall) return
    const myExt = this.authService.getCurrentExtension()

    // Nâng cấp từ Cuộc gọi 1-1 lên Cuộc gọi nhóm Ad-hoc (Call Escalation)
    if (!this.state.isGroupCall && this.callController.hasActiveCall()) {
      logger.info('CALL', '👥 Nâng cấp cuộc gọi 1-1 lên cuộc gọi nhóm Ad-hoc Conference...')
      this.state.isGroupCall = true
      this.state.isGroupHost = true
      this.state.groupHostExtension = myExt
      const peerExt = String(callState.activeCall?.number || '').trim()
      this.state.groupParticipantExtensions = [myExt]
      if (peerExt && !this.state.groupParticipantExtensions.includes(peerExt)) {
        this.state.groupParticipantExtensions.push(peerExt)
      }
      if (callState.activeCall) {
        callState.activeCall.isGroupCall = true
        callState.activeCall.isGroupHost = true
        callState.activeCall.groupHostExtension = myExt
        callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
        callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length + extensions.length} người)`
      }
    } else if (!this.state.isGroupHost) {
      const hostExt = this.state.groupHostExtension || callState.activeCall?.number
      if (hostExt && hostExt !== myExt) {
        this.delegateAddParticipantsToHost(hostExt, extensions)
        return
      }
    }

    const toInvite = []
    const busyOrUnavailable = []
    for (const ext of extensions) {
      const s = String(ext || '').trim()
      if (!s || s === myExt) continue

      if (!this.contactService.isContactAvailableForCall(s)) {
        const c = this.contactService.findContactByExtension(s)
        const nameOrExt = c?.name ? `${c.name} (${s})` : `Máy lẻ ${s}`
        busyOrUnavailable.push({ ext: s, label: nameOrExt })
        continue
      }

      if (!this.state.groupParticipantExtensions.includes(s)) {
        this.state.groupParticipantExtensions.push(s)
      }
      if (!toInvite.includes(s)) {
        toInvite.push(s)
      }
    }

    if (busyOrUnavailable.length > 0) {
      const busyNames = busyOrUnavailable.map((b) => b.label).join(', ')
      logger.warn('CALL', `Không thể mời các máy lẻ bận/không khả dụng vào nhóm: ${busyNames}`)
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ [${busyNames}] hiện đang bận hoặc không khả dụng, không thể mời vào nhóm!`,
            type: 'warning',
          },
        }),
      )
      this.broadcastNoticeToGroup(
        `Máy lẻ ${busyOrUnavailable.map((b) => b.ext).join(', ')} đang bận`,
      )
    }

    if (toInvite.length === 0) return

    logger.info('CALL', `Mời thêm thành viên vào nhóm: ${toInvite.join(', ')}`)
    if (callState.activeCall) {
      callState.activeCall.isGroupCall = true
      callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
    }
    this.broadcastGroupStateViaPresence()

    // Khởi tạo các nhánh gọi tới từng máy lẻ qua WebRTC Phone mà không hold nhánh trước
    for (const ext of toInvite) {
      if (!current()) return
      const phoneInstance = this.sdk.Phone?.phone
      const prevSipSession = phoneInstance?.currentSipSession
      const prevCallSession = phoneInstance?.currentCallSession
      try {
        logger.info('CALL', `Đang gửi tín hiệu gọi nhánh thành viên: ${ext}...`)

        // Bảo vệ nhánh đầu tiên: tạm thời tách currentSipSession để Wazo.Phone không gửi lệnh hold sai quy cách lên nhánh đang đổ chuông
        if (phoneInstance && phoneInstance.currentSipSession) {
          phoneInstance.currentSipSession = null
        }

        const session = await this.sdk.Phone.call(ext, false)
        if (!current()) {
          if (session) await this.sdk.Phone.hangup(session).catch(() => {})
          return
        }

        if (session) {
          this.state.secondaryCallSessions.set(ext, session)
          this.startParticipantInviteTimeout(ext, session)
        }
      } catch (err) {
        if (!current()) return
        logger.warn('CALL', `Không thể gọi nhánh ${ext}:`, err.message || err)
        this.broadcastNoticeToGroup(`Không thể kết nối máy lẻ ${ext}`)
      } finally {
        if (current() && phoneInstance && prevSipSession) {
          phoneInstance.currentSipSession = prevSipSession
          phoneInstance.currentCallSession = prevCallSession
        }
      }
    }
  }

  /** Đặt thời hạn chờ trả lời của nhánh gọi đầu tiên. */
  startPrimaryInviteTimeout(targetExt) {
    this.clearPrimaryInviteTimeout()
    this._primaryInviteTimer = setTimeout(() => {
      this.cancelPrimaryInvite(targetExt)
    }, 30000)
    logger.info('CALL', `⏱️ Đã đặt bộ đếm Timeout 30 giây cho nhánh chính [${targetExt}].`)
  }

  /** Hủy timer chờ nhánh đầu tiên sau khi kết nối hoặc kết thúc. */
  clearPrimaryInviteTimeout() {
    if (this._primaryInviteTimer) {
      clearTimeout(this._primaryInviteTimer)
      this._primaryInviteTimer = null
    }
  }

  /** Hủy nhánh đầu tiên quá hạn mà vẫn giữ các nhánh còn hoạt động. */
  cancelPrimaryInvite(targetExt) {
    this.clearPrimaryInviteTimeout()
    if (
      this.state.isGroupCall &&
      this.state.isGroupHost &&
      callState.activeCall &&
      callState.activeCall.status === 'ringing'
    ) {
      logger.warn(
        'CALL',
        `Nhánh chính [${targetExt}] quá 30 giây không nhấc máy. Tiến hành ngắt kết nối nhánh chính.`,
      )
      const session = this.callController.currentCallSession
      if (session) {
        try {
          this.sdk.Phone.hangup(session)
        } catch (e) {
          /* ignore */
        }
      }

      // Gỡ targetExt khỏi groupParticipantExtensions

      this.state.groupParticipantExtensions = this.state.groupParticipantExtensions.filter(
        (e) => e !== targetExt,
      )
      if (callState.activeCall) {
        callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
        callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`
      }
      this.broadcastGroupStateViaPresence()

      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⏱️ Máy lẻ [${targetExt}] không trả lời sau 30 giây.`,
            type: 'warning',
          },
        }),
      )
      this.broadcastNoticeToGroup(`Máy lẻ ${targetExt} không trả lời sau 30 giây`)

      // Nếu còn nhánh phụ đang hoạt động hoặc đang đổ chuông, chuyển nhánh phụ lên
      if (this.state.secondaryCallSessions.size > 0) {
        const [nextExt, nextSession] = this.state.secondaryCallSessions.entries().next().value
        logger.info(
          'CALL',
          `Tự động chuyển nhánh [${nextExt}] lên làm nhánh chính tiếp tục cuộc gọi nhóm.`,
        )
        this.state.secondaryCallSessions.delete(nextExt)
        this.callController.currentCallSession = nextSession
        if (callState.activeCall) {
          callState.activeCall.number = nextExt
          callState.activeCall.session = nextSession
        }
        this.broadcastGroupStateViaPresence()
      } else if (!this.isAnyParticipantConnected()) {
        logger.warn('CALL', 'Tất cả thành viên đều không trả lời cuộc gọi nhóm. Kết thúc cuộc gọi.')
        window.dispatchEvent(
          new CustomEvent('app-toast', {
            detail: {
              message: '👥 Tất cả thành viên đều không trả lời cuộc gọi nhóm.',
              type: 'warning',
            },
          }),
        )
        this.callController.hangupCurrentCall()
      }
    }
  }

  /** Kiểm tra nhóm đã có ít nhất một người tham gia kết nối. */
  isAnyParticipantConnected() {
    if (!this.callController.hasActiveCall()) return false
    const myExt = this.authService.getCurrentExtension()
    const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)

    if (callState.activeCall?.status === 'connected') {
      if (this.state.isGroupCall) {
        if (
          remainingOthers.length > 0 &&
          (this.state.extensionToWazoCallIdMap.size > 0 ||
            this.state.activeAdhocConferenceId ||
            this.callController.currentCallSession)
        ) {
          return true
        }
      } else {
        return true
      }
    }

    if (this.state.extensionToWazoCallIdMap && this.state.extensionToWazoCallIdMap.size > 0) {
      return true
    }

    return false
  }

  /** Đặt thời hạn chờ trả lời cho một máy lẻ được mời. */
  startParticipantInviteTimeout(ext, session) {
    this.clearParticipantInviteTimeout(ext)
    const timer = setTimeout(() => {
      this.cancelParticipantInvite(ext)
    }, 30000)
    this._secondaryInviteTimers.set(ext, timer)
    logger.info('CALL', `⏱️ Đã đặt bộ đếm Timeout 30 giây cho nhánh phụ [${ext}].`)
  }

  /** Hủy timer lời mời của máy lẻ đã có kết quả. */
  clearParticipantInviteTimeout(ext) {
    if (this._secondaryInviteTimers.has(ext)) {
      clearTimeout(this._secondaryInviteTimers.get(ext))
      this._secondaryInviteTimers.delete(ext)
    }
  }

  /** Thu hồi toàn bộ timer lời mời khi cuộc gọi nhóm kết thúc. */
  clearAllParticipantInviteTimeouts() {
    for (const [, timer] of this._secondaryInviteTimers.entries()) {
      clearTimeout(timer)
    }
    this._secondaryInviteTimers.clear()
  }

  /** Ngắt nhánh quá hạn và đồng bộ lại danh sách người tham gia. */
  cancelParticipantInvite(targetExt) {
    this.clearParticipantInviteTimeout(targetExt)
    const session = this.state.secondaryCallSessions.get(targetExt)
    if (session) {
      const sipId = session.sipCallId || (session.getId && session.getId()) || session.id
      if (sipId) {
        this._terminatingSecondarySipIds.add(String(sipId))
      }
      logger.warn(
        'CALL',
        `Nhánh phụ [${targetExt}] quá 30 giây không nhấc máy. Tiến hành ngắt kết nối nhánh phụ.`,
      )
      try {
        this.sdk.Phone.hangup(session)
      } catch (e) {
        /* ignore */
      }
      // Không delete khỏi this.secondaryCallSessions ngay để _finalizeCallTermination nhận diện được nhánh phụ!
    }

    // Gỡ khỏi groupParticipantExtensions nếu chưa bao giờ kết nối
    const idx = this.state.groupParticipantExtensions.indexOf(targetExt)
    if (idx >= 0) {
      this.state.groupParticipantExtensions.splice(idx, 1)
      if (callState.activeCall) {
        callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
        callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`
      }
      this.broadcastGroupStateViaPresence()
    }

    // Phát thông báo UI cục bộ và phát thẻ NOTICE cho cả nhóm
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `⏱️ Máy lẻ [${targetExt}] không trả lời sau 30 giây.`, type: 'warning' },
      }),
    )
    this.broadcastNoticeToGroup(`Máy lẻ ${targetExt} không trả lời sau 30 giây`)

    // Kiểm tra: Nếu tất cả thành viên khác đều không nghe máy và không còn ai đang kết nối
    const myExt = this.authService.getCurrentExtension()
    const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)
    if (
      remainingOthers.length === 0 &&
      !this.isAnyParticipantConnected() &&
      (!this.callController.currentCallSession || callState.activeCall?.status !== 'ringing')
    ) {
      logger.warn('CALL', 'Tất cả thành viên đều không trả lời cuộc gọi nhóm. Kết thúc cuộc gọi.')
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: '👥 Tất cả thành viên đều không trả lời cuộc gọi nhóm.',
            type: 'warning',
          },
        }),
      )
      this.callController.hangupCurrentCall()
    }
  }

  /** Gửi yêu cầu mời thêm người tới chủ nhóm theo metadata presence hiện hành. */
  delegateAddParticipantsToHost(hostExt, targetExtensions) {
    if (!hostExt || !targetExtensions || targetExtensions.length === 0) return
    const myExt = this.authService.getCurrentExtension()
    const toInviteNow = []
    const dropped = []

    for (const rawExt of targetExtensions) {
      const e = String(rawExt || '').trim()
      if (!e || e === myExt || e === hostExt) continue
      if (this.contactService.isContactAvailableForCall(e)) {
        toInviteNow.push(e)
      } else {
        const c = this.contactService.findContactByExtension(e)
        dropped.push(c?.name ? `${c.name} (${e})` : `Máy lẻ ${e}`)
      }
    }

    if (dropped.length > 0) {
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: {
            message: `⚠️ [${dropped.join(', ')}] hiện đang bận hoặc không khả dụng, không thể gửi yêu cầu mời vào nhóm!`,
            type: 'warning',
          },
        }),
      )
    }

    if (toInviteNow.length === 0) return

    const reqId = Date.now()
    const reqTag = `[ADD_REQ:${reqId}:${hostExt}:${toInviteNow.join(',')}]`
    logger.info('CALL', `Máy thành viên ủy quyền cho Chủ phòng (${hostExt}) mời thêm: ${reqTag}`)
    this.authService.updatePresence('unavailable', `Đang bận ${reqTag}`)
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          message: `📤 Đã gửi yêu cầu thêm người tới Chủ phòng (${hostExt})`,
          type: 'info',
        },
      }),
    )
  }

  /** Phát thông báo cuộc gọi tới các thành viên theo kênh presence. */
  broadcastNoticeToGroup(message) {
    if (!this.state.isGroupCall || !this.state.isGroupHost) return
    const noticeId = Date.now()
    const myExt = this.authService.getCurrentExtension()
    const noticeTag = `[NOTICE:${noticeId}:${myExt}:${message}]`
    this.authService.updatePresence('unavailable', `Đang gọi nhóm ${noticeTag}`)
  }

  /** Gộp các yêu cầu đồng bộ hội nghị để tránh thực hiện song song. */
  syncActiveCallsToAdhocConference() {
    if (!this.callController.hasActiveCall() || !this.state.isGroupCall || !this.state.isGroupHost)
      return

    if (this._syncAdhocDebounceTimer) {
      clearTimeout(this._syncAdhocDebounceTimer)
      this._syncAdhocDebounceTimer = null
    }

    this._syncAdhocDebounceTimer = setTimeout(async () => {
      this._syncAdhocDebounceTimer = null
      if (this._isSyncingAdhoc) return
      this._isSyncingAdhoc = true
      try {
        await this.synchronizeActiveCalls()
      } catch (err) {
        logger.warn('CALL', 'Lỗi trong quá trình đồng bộ Ad-hoc Conference:', err)
      } finally {
        this._isSyncingAdhoc = false
      }
    }, 350)
  }

  /** Hợp nhất các nhánh đã được server xác nhận; không đánh dấu merge khi API lỗi. */
  async synchronizeActiveCalls() {
    const sessionContext = captureSessionContext()
    if (!this.callController.hasActiveCall() || !this.state.isGroupCall || !this.state.isGroupHost)
      return

    const callEpoch = this.callController.callGeneration
    const current = () =>
      callEpoch === this.callController.callGeneration &&
      isSessionContextCurrent(sessionContext) &&
      this.callController.hasActiveCall()
    const activeCalls = await this.callControlApi.listActiveCalls()
    if (!current()) return
    if (!activeCalls || activeCalls.length === 0) return

    // 1. Xác định hostCallId từ primary session của Host
    let hostCallId = ''
    const myPrimarySipId = this.callController.currentCallSession?.sipCallId

    for (const callObj of activeCalls) {
      const cid = callObj.id || callObj.call_id
      const sipId = callObj.sip_call_id
      if (myPrimarySipId && sipId === myPrimarySipId) {
        hostCallId = cid
        break
      }
    }
    if (!hostCallId && activeCalls.length > 0) {
      hostCallId = activeCalls[0].id || activeCalls[0].call_id
    }
    if (!hostCallId) return

    // 2. Thu thập TẤT CẢ các peerCallId từ talking_to của các cuộc gọi
    // BÁM SÁT 100% Android WazoSipCallManager.py lines 748-755:
    // TUYỆT ĐỐI KHÔNG đưa cid (kênh WebRTC cục bộ của Host) vào participant_call_ids!
    let hasUnbridgedLeg = false
    for (const callObj of activeCalls) {
      const cid = callObj.id || callObj.call_id
      const sipId = callObj.sip_call_id
      const isTalking =
        callObj.status === 'talking' ||
        (callObj.talking_to &&
          typeof callObj.talking_to === 'object' &&
          Object.keys(callObj.talking_to).length > 0)

      if (callObj.talking_to && typeof callObj.talking_to === 'object') {
        for (const peerId of Object.keys(callObj.talking_to)) {
          if (peerId && peerId !== hostCallId) {
            let matchedExt = null
            for (const [ext, secSession] of this.state.secondaryCallSessions.entries()) {
              const secSip =
                secSession?.sipCallId || (secSession?.getId && secSession.getId()) || secSession?.id
              if (
                secSession.sipCallId === sipId ||
                (secSip && sipId && String(secSip) === String(sipId))
              ) {
                matchedExt = ext
                break
              }
            }
            if (matchedExt) {
              this.state.extensionToWazoCallIdMap.set(matchedExt, peerId)
            } else if (callState.activeCall?.number) {
              this.state.extensionToWazoCallIdMap.set(callState.activeCall.number, peerId)
            }
          }
        }
      } else if (isTalking && cid !== hostCallId) {
        hasUnbridgedLeg = true
      }
    }

    // Nếu có nhánh phụ đã talking nhưng Asterisk chưa kịp link talking_to -> Hẹn giờ thử lại sau 300ms
    if (hasUnbridgedLeg && this.state.extensionToWazoCallIdMap.size < 2) {
      logger.info(
        'CALL',
        'Đang đợi máy chủ Asterisk điền talking_to cho nhánh phụ, sẽ thử lại sau 300ms...',
      )
      setTimeout(() => {
        if (current() && this.state.isGroupCall && this.state.isGroupHost) {
          this.syncActiveCallsToAdhocConference()
        }
      }, 300)
    }

    // Hủy bộ đếm timeout 30s cho các nhánh đã kết nối thành công vào extensionToWazoCallIdMap
    for (const [secExt] of this.state.secondaryCallSessions.entries()) {
      if (this.state.extensionToWazoCallIdMap.has(secExt)) {
        this.clearParticipantInviteTimeout(secExt)
      }
    }

    const participantCallIds = Array.from(
      new Set(this.state.extensionToWazoCallIdMap.values()),
    ).filter((id) => id && id !== hostCallId)

    // Nếu chưa đủ 2 nhánh thành viên (chỉ có Host + 1 người nghe máy) và chưa có phòng họp nhóm:
    if (participantCallIds.length < 2 && !this.state.activeAdhocConferenceId) {
      logger.info(
        'CALL',
        `Chưa đủ 2 thành viên đàm thoại (hiện có ${participantCallIds.length} người nghe máy). Duy trì thoại trực tiếp và chờ người tiếp theo...`,
      )
      // Nếu nhánh chính vẫn đang ringing mà đã có 1 nhánh phụ talking -> Đưa âm thanh nhánh nghe máy lên đàm thoại ngay (Đối chiếu WazoSipCallManager.py line 1780)
      if (
        callState.activeCall &&
        callState.activeCall.status === 'ringing' &&
        participantCallIds.length === 1
      ) {
        callState.activeCall.status = 'connected'
        callState.activeCall.startTime = Date.now()
        this.callToneService.stopRingbackTone()
        for (const [secExt, secSession] of this.state.secondaryCallSessions.entries()) {
          try {
            const stream = this.sdk.Phone.getRemoteStream(secSession)
            if (stream) {
              this.phoneAdapter.playCallAudio(stream)
              logger.info('AUDIO', `Đã kết nối âm thanh với nhánh phụ nghe trước: ${secExt}`)
              break
            }
          } catch (e) {}
        }
      }
      return
    }

    logger.info(
      'CALL',
      `👥 Bắt đầu đồng bộ Ad-hoc Conference: Host=[${hostCallId}], Participants=[${participantCallIds.join(', ')}]`,
    )

    // Nếu đã có activeAdhocConferenceId: Thêm các participant chưa merge
    if (this.state.activeAdhocConferenceId) {
      for (const pId of participantCallIds) {
        if (!this.state.mergedCallIds.has(pId) && pId !== hostCallId) {
          const added = await this.callControlApi.addConferenceParticipant(
            this.state.activeAdhocConferenceId,
            pId,
          )
          if (!current()) return
          if (added) this.state.mergedCallIds.add(pId)
          else this.scheduleConferenceRetry(callEpoch)
        }
      }
      return
    }

    // Chưa có conference_id: Tạo mới Ad-hoc Conference khi có ít nhất 2 thành viên
    const toMerge = participantCallIds.filter((id) => id !== hostCallId)
    if (toMerge.length >= 2 && hostCallId) {
      toMerge.forEach((id) => this.state.mergedCallIds.add(id))
      const confId = await this.callControlApi.createConference(hostCallId, toMerge)
      if (!current()) {
        if (confId && isSessionContextCurrent(sessionContext))
          await this.callControlApi.deleteConference(confId)
        return
      }
      if (confId) {
        this.state.activeAdhocConferenceId = confId
        if (callState.activeCall) {
          callState.activeCall.activeAdhocConferenceId = confId
        }
        this.broadcastGroupStateViaPresence()
      } else {
        this.state.mergedCallIds.clear()
        this.scheduleConferenceRetry(callEpoch)
      }
    }
  }

  /** Gỡ người rời nhóm và kết thúc nhóm khi không còn nhánh hợp lệ. */
  handleParticipantLeftGroupCall(leftCallIdOrExt) {
    if (!this.state.isGroupCall) return

    let leftExt = null
    const targetStr = String(leftCallIdOrExt).trim()

    // 1. Kiểm tra xem có khớp thẳng với extension không
    if (this.state.groupParticipantExtensions.includes(targetStr)) {
      leftExt = targetStr
    } else {
      // 2. Tìm trong extensionToWazoCallIdMap
      for (const [ext, cId] of this.state.extensionToWazoCallIdMap.entries()) {
        if (cId === targetStr) {
          leftExt = ext
          break
        }
      }
    }

    if (!leftExt) return

    const myExt = this.authService.getCurrentExtension()
    // Tuyệt đối không tự xóa chính mình khỏi nhóm
    if (leftExt === myExt) return

    // Hủy timer timeout nếu còn
    this.clearParticipantInviteTimeout(leftExt)

    logger.info('CALL', `Thành viên [${leftExt}] đã rời cuộc gọi nhóm.`)
    const cId = this.state.extensionToWazoCallIdMap.get(leftExt)
    if (cId) this.state.mergedCallIds.delete(cId)
    this.state.extensionToWazoCallIdMap.delete(leftExt)
    this.state.secondaryCallSessions.delete(leftExt)

    this.state.groupParticipantExtensions = this.state.groupParticipantExtensions.filter(
      (e) => e !== leftExt,
    )
    if (callState.activeCall) {
      callState.activeCall.groupParticipantExtensions = [...this.state.groupParticipantExtensions]
      callState.activeCall.groupTitle = `Cuộc gọi nhóm (${this.state.groupParticipantExtensions.length} người)`

      // Khi một thành viên rời đi, nếu activeCall.number đang trỏ vào thành viên đó, chuyển sang thành viên tiếp theo còn lại
      if (callState.activeCall.number === leftExt) {
        const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)
        if (remainingOthers.length > 0) {
          callState.activeCall.number = remainingOthers[0]
          const contact = this.contactService.findContactByExtension(remainingOthers[0])
          if (contact?.name) {
            callState.activeCall.name = contact.name
          }
        }
      }
    }

    // Nếu máy này là thành viên và nhận tin Chủ phòng rời khỏi cuộc gọi -> kết thúc cuộc gọi
    if (!this.state.isGroupHost && leftExt === this.state.groupHostExtension) {
      logger.info(
        'CALL',
        `Chủ phòng (${this.state.groupHostExtension}) đã kết thúc cuộc gọi -> Ngắt máy thành viên.`,
      )
      window.dispatchEvent(
        new CustomEvent('app-toast', {
          detail: { message: '👥 Chủ phòng đã kết thúc cuộc gọi nhóm.', type: 'info' },
        }),
      )
      this.callController.hangupCurrentCall()
      return
    }

    if (this.state.isGroupHost) {
      this.broadcastGroupStateViaPresence()

      // Nếu trong nhóm chỉ còn lại đúng 1 người (chính là Host) và không còn nhánh phụ nào đang đổ chuông
      const remainingOthers = this.state.groupParticipantExtensions.filter((e) => e !== myExt)
      if (remainingOthers.length === 0 && this.state.secondaryCallSessions.size === 0) {
        logger.info('CALL', 'Tất cả thành viên đã rời nhóm. Tự động kết thúc cuộc gọi.')
        this.callController.hangupCurrentCall()
      }
    }

    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: { message: `👋 Máy lẻ ${leftExt} đã rời cuộc gọi nhóm.`, type: 'info' },
      }),
    )
  }

  /** Phát danh sách thành viên để các client cập nhật cùng trạng thái nhóm. */
  broadcastGroupStateViaPresence() {
    if (!this.state.isGroupCall) return
    const myExt = this.authService.getCurrentExtension()
    const hostExt = this.state.groupHostExtension || myExt
    const exts =
      this.state.groupParticipantExtensions.length > 0
        ? this.state.groupParticipantExtensions
        : [myExt]
    const groupTag = `[GROUP:${hostExt}:${exts.join(',')}]`
    this.authService.updatePresence('unavailable', `Đang gọi nhóm ${groupTag}`)
  }

  /** Tăng thế hệ cuộc gọi và dọn state, timer, Map của hội nghị. */
  resetGroupState() {
    this.callController.callGeneration += 1
    clearTimeout(this._syncAdhocRetryTimer)
    this._syncAdhocRetryTimer = null
    this._adhocRetryCount = 0
    if (this._syncAdhocDebounceTimer) {
      clearTimeout(this._syncAdhocDebounceTimer)
      this._syncAdhocDebounceTimer = null
    }
    this.clearAllParticipantInviteTimeouts()
    this.clearPrimaryInviteTimeout()
    this._processedAddReqIds.clear()
    this._processedNoticeIds.clear()
    this._terminatingSecondarySipIds.clear()
    this._isSyncingAdhoc = false
    this.state.activeAdhocConferenceId = ''
    this.state.isGroupCall = false
    this.state.isGroupHost = false
    this.state.groupHostExtension = ''
    this.state.groupParticipantExtensions = []
    this.state.extensionToWazoCallIdMap.clear()
    this.state.mergedCallIds.clear()
    this.state.secondaryCallSessions.clear()
  }
}
